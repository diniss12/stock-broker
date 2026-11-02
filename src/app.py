import os
import re
import json
import time
import uuid
import urllib.request
import boto3
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["TABLE_NAME"])

FINNHUB_API_KEY = os.environ.get(
    "FINNHUB_API_KEY", "dbfpd09r01qiahuaj96gdbfpd09r01qiahuaj970"
)

DEFAULT_TICKERS = [
    "NVDA", "AMZN", "AAPL", "GOOGL", "MSFT", "TSLA",
    "META", "BRK.B", "TSM", "AVGO", "JPM", "V"
]

DEFAULT_EUR_USD_RATE = Decimal("1.0850")

# Regex defensiva: apenas 1 a 6 letras maiúsculas, com sufixo de classe opcional (.A, .B)
TICKER_REGEX = re.compile(r"^[A-Z]{1,6}(\.[A-Z]{1,2})?$")


class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, cls=DecimalEncoder),
    }


# ==========================================
# VALIDAÇÃO DEFENSIVA DE INPUTS
# ==========================================

def validate_transaction_payload(raw_body):
    """
    Sanitiza e valida rigorosamente todos os campos de entrada,
    incluindo moedas e taxa de câmbio manual (exchange_rate).
    """
    if not raw_body:
        return False, "O corpo do pedido não pode estar vazio."

    try:
        body = json.loads(raw_body)
    except Exception:
        return False, "Formato JSON inválido."

    # 1. Campos obrigatórios
    required_fields = ["ticker", "shares", "price"]
    for field in required_fields:
        if field not in body:
            return False, f"Campo obrigatório em falta: '{field}'."

    # 2. Sanitização e validação de Ticker
    raw_ticker = str(body["ticker"]).upper().strip()
    if not TICKER_REGEX.match(raw_ticker):
        return False, "Ticker inválido. Usa apenas letras (ex: NVDA, AAPL, BRK.B) até 6 caracteres."

    # 3. Tipo de transação
    tx_type = str(body.get("type", "BUY")).upper().strip()
    if tx_type not in ("BUY", "SELL"):
        return False, "Tipo de transação inválido. Usa 'BUY' ou 'SELL'."

    # 4. Moedas (Ativo e Base do Utilizador)
    asset_currency = str(body.get("asset_currency", "USD")).upper().strip()
    base_currency = str(body.get("base_currency", "EUR")).upper().strip()
    if asset_currency not in ("USD", "EUR") or base_currency not in ("USD", "EUR"):
        return False, "Moeda não suportada. Usa 'USD' ou 'EUR'."

    # 5. Parsing numérico seguro (Quantidade, Preço e Taxa de Câmbio)
    try:
        shares = Decimal(str(body["shares"]))
        price = Decimal(str(body["price"]))
    except (InvalidOperation, TypeError, ValueError):
        return False, "Os campos 'shares' e 'price' devem ser números válidos."

    if shares <= 0:
        return False, "A quantidade de ações (shares) deve ser maior que 0."
    if price < 0:
        return False, "O preço unitário não pode ser negativo."
    if shares > Decimal("1000000000") or price > Decimal("10000000"):
        return False, "Valores de quantidade ou preço fora dos limites suportados."

    # Se a moeda do ativo e a moeda base forem iguais, a taxa é sempre 1.0
    if asset_currency == base_currency:
        exchange_rate = Decimal("1.0")
    else:
        raw_fx = body.get("exchange_rate", 1.0)
        try:
            exchange_rate = Decimal(str(raw_fx))
        except (InvalidOperation, TypeError, ValueError):
            return False, "A taxa de câmbio ('exchange_rate') deve ser um número válido."

        if exchange_rate <= Decimal("0.01") or exchange_rate > Decimal("100"):
            return False, "Taxa de câmbio fora de limites realistas."

    # 6. Validação rigorosa de Data (formato YYYY-MM-DD e sem datas futuras)
    now_iso = datetime.now(timezone.utc).isoformat()
    today_str = now_iso[:10]
    tx_date = str(body.get("date", today_str)).strip()

    try:
        parsed_date = datetime.strptime(tx_date, "%Y-%m-%d").date()
        today_date = datetime.now(timezone.utc).date()
        if parsed_date > today_date:
            return False, "A data da operação não pode ser futura."
    except ValueError:
        return False, "Formato de data inválido. Usa rigorosamente o padrão YYYY-MM-DD."

    name = str(body.get("name", "")).strip()

    return True, {
        "ticker": raw_ticker,
        "name": name,
        "type": tx_type,
        "shares": shares,
        "price": price,
        "asset_currency": asset_currency,
        "base_currency": base_currency,
        "exchange_rate": exchange_rate,
        "date": tx_date,
    }


# ==========================================
# FUNÇÕES DE MERCADO (FINNHUB) E CÂMBIO (FRANKFURTER / BCE)
# ==========================================

def fetch_ecb_eur_usd_rate() -> Decimal | None:
    """
    Obtém a taxa de câmbio oficial EUR/USD do Banco Central Europeu
    através da API pública Frankfurter (quantos USD valem 1 EUR).
    """
    url = "https://api.frankfurter.app/latest?from=EUR&to=USD"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "StockBrokerApp/1.0"})
        with urllib.request.urlopen(req, timeout=4) as res:
            data = json.loads(res.read().decode("utf-8"))
            usd_rate = data.get("rates", {}).get("USD")
            if usd_rate:
                rate_dec = Decimal(str(round(float(usd_rate), 4)))
                now_iso = datetime.now(timezone.utc).isoformat()
                table.put_item(
                    Item={
                        "PK": "MARKET#FX",
                        "SK": "PAIR#EUR_USD",
                        "rate": rate_dec,
                        "ecb_date": data.get("date", now_iso[:10]),
                        "updated_at": now_iso,
                    }
                )
                return rate_dec
    except Exception as e:
        print(f"Erro ao consultar Frankfurter API (BCE): {e}")
    return None


def get_cached_eur_usd_rate() -> Decimal:
    """
    Lê a taxa EUR/USD em cache no DynamoDB. Se tiver mais de 12 horas ou não existir,
    consulta a API Frankfurter (BCE) e atualiza a cache.
    """
    item = table.get_item(
        Key={"PK": "MARKET#FX", "SK": "PAIR#EUR_USD"}
    ).get("Item")

    now_iso = datetime.now(timezone.utc).isoformat()
    today_str = now_iso[:10]

    if item and "rate" in item:
        updated_day = str(item.get("updated_at", ""))[:10]
        if updated_day == today_str:
            return Decimal(str(item["rate"]))

    fresh_rate = fetch_ecb_eur_usd_rate()
    if fresh_rate:
        return fresh_rate

    if item and "rate" in item:
        return Decimal(str(item["rate"]))

    return DEFAULT_EUR_USD_RATE


def fetch_finnhub_quote(ticker: str) -> dict | None:
    """Busca o preço atual, fecho anterior e variação diária na Finnhub."""
    ticker = ticker.upper().strip()
    url = f"https://finnhub.io/api/v1/quote?symbol={ticker}&token={FINNHUB_API_KEY}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "StockBrokerApp/1.0"})
        with urllib.request.urlopen(req, timeout=5) as res:
            data = json.loads(res.read().decode("utf-8"))
            if not data or data.get("c", 0) == 0:
                return None

            now_iso = datetime.now(timezone.utc).isoformat()
            return {
                "PK": "MARKET#PRICE",
                "SK": f"TICKER#{ticker}",
                "ticker": ticker,
                "price": Decimal(str(round(data["c"], 2))),
                "prev_close": Decimal(str(round(data.get("pc") or 0, 2))),
                "change": Decimal(str(round(data.get("d") or 0, 2))),
                "change_pct": Decimal(str(round(data.get("dp") or 0, 2))),
                "high": Decimal(str(round(data.get("h") or 0, 2))),
                "low": Decimal(str(round(data.get("l") or 0, 2))),
                "price_date": now_iso[:10],
                "updated_at": now_iso,
            }
    except Exception as e:
        print(f"Erro ao consultar Finnhub para {ticker}: {e}")
        return None


def get_tracked_tickers() -> list[str]:
    """Obtém a lista de ações monitorizadas (12 base + carteiras dos users)."""
    item = table.get_item(
        Key={"PK": "MARKET#CONFIG", "SK": "TRACKED_TICKERS"}
    ).get("Item")

    if not item or "tickers" not in item:
        table.put_item(
            Item={
                "PK": "MARKET#CONFIG",
                "SK": "TRACKED_TICKERS",
                "tickers": DEFAULT_TICKERS,
            }
        )
        return list(DEFAULT_TICKERS)

    combined = list(set(DEFAULT_TICKERS + list(item["tickers"])))
    return sorted(combined)


def ensure_ticker_tracked(ticker: str, fallback_price: Decimal | None = None) -> dict | None:
    """Garante que o ticker está na lista global e tem preço na cache MARKET#PRICE."""
    ticker = ticker.upper().strip()
    if not TICKER_REGEX.match(ticker):
        return None

    tracked = get_tracked_tickers()
    if ticker not in tracked:
        tracked.append(ticker)
        table.put_item(
            Item={
                "PK": "MARKET#CONFIG",
                "SK": "TRACKED_TICKERS",
                "tickers": tracked,
            }
        )

    existing = table.get_item(
        Key={"PK": "MARKET#PRICE", "SK": f"TICKER#{ticker}"}
    ).get("Item")
    if existing:
        return existing

    quote = fetch_finnhub_quote(ticker)
    if quote:
        table.put_item(Item=quote)
        return quote

    if fallback_price is not None:
        now_iso = datetime.now(timezone.utc).isoformat()
        fallback_item = {
            "PK": "MARKET#PRICE",
            "SK": f"TICKER#{ticker}",
            "ticker": ticker,
            "price": fallback_price,
            "prev_close": fallback_price,
            "change": Decimal("0"),
            "change_pct": Decimal("0"),
            "price_date": now_iso[:10],
            "updated_at": now_iso,
        }
        table.put_item(Item=fallback_item)
        return fallback_item

    return None


def market_updater_handler(event, context):
    """Handler chamado pelo EventBridge (ou manualmente) para atualizar preços e câmbio BCE."""
    tickers = get_tracked_tickers()
    updated = []

    with table.batch_writer() as batch:
        for ticker in tickers:
            quote = fetch_finnhub_quote(ticker)
            if quote:
                batch.put_item(Item=quote)
                updated.append(quote)
            time.sleep(0.1)

    fx_rate = fetch_ecb_eur_usd_rate() or get_cached_eur_usd_rate()

    return response(200, {
        "message": "Cache de mercado e câmbio atualizados com sucesso",
        "updated_count": len(updated),
        "fx_rate_eur_usd": fx_rate,
        "tickers": updated,
    })


def handle_get_market():
    """Devolve todas as cotações em cache no DynamoDB (público para barra de Login)."""
    res = table.query(
        KeyConditionExpression=Key("PK").eq("MARKET#PRICE") & Key("SK").begins_with("TICKER#")
    )
    items = res.get("Items", [])

    if not items:
        market_updater_handler({}, None)
        res = table.query(
            KeyConditionExpression=Key("PK").eq("MARKET#PRICE") & Key("SK").begins_with("TICKER#")
        )
        items = res.get("Items", [])

    return response(200, {"tickers": items})


# ==========================================
# HANDLER PRINCIPAL DA API GATEWAY
# ==========================================

def lambda_handler(event, context):
    if event.get("source") == "aws.events" or event.get("action") == "UPDATE_MARKET":
        return market_updater_handler(event, context)

    route_key = event.get("routeKey")

    # Rota pública sem autenticação
    if route_key == "GET /market":
        return handle_get_market()

    # Extrai as claims validadas pelo API Gateway
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )

    user_id = claims.get("sub") or claims.get("cognito:username")

    if not user_id:
        return response(401, {"error": "Não autorizado: token em falta ou inválido."})

    if route_key == "POST /transaction":
        return handle_post_transaction(user_id, event.get("body"))
    elif route_key == "GET /portfolio":
        return handle_get_portfolio(user_id)

    return response(404, {"error": "Rota não encontrada."})


# ==========================================
# TRANSAÇÕES E CARTEIRA DO UTILIZADOR
# ==========================================

def handle_post_transaction(user_id, raw_body):
    # 1. Executa validação estrita antes de tocar na base de dados
    valid, validated_or_err = validate_transaction_payload(raw_body)
    if not valid:
        return response(400, {"error": validated_or_err})

    ticker = validated_or_err["ticker"]
    name = validated_or_err["name"]
    tx_type = validated_or_err["type"]
    shares = validated_or_err["shares"]
    price_native = validated_or_err["price"]
    asset_currency = validated_or_err["asset_currency"]
    base_currency = validated_or_err["base_currency"]
    exchange_rate = validated_or_err["exchange_rate"]
    tx_date = validated_or_err["date"]

    # 2. Conversão exata da transação para ambos os referenciais (USD e EUR)
    # Nota: exchange_rate representa EUR/USD (ex: 1 EUR = 1.0850 USD)
    if asset_currency == "USD":
        price_usd = price_native
        price_eur = (price_native / exchange_rate) if exchange_rate > 0 else price_native
    else:  # asset_currency == "EUR"
        price_eur = price_native
        price_usd = price_native * exchange_rate

    total_native = round(shares * price_native, 2)
    total_usd = round(shares * price_usd, 2)
    total_eur = round(shares * price_eur, 2)
    total_base_currency = total_eur if base_currency == "EUR" else total_usd

    now_iso = datetime.now(timezone.utc).isoformat()
    pk = f"USER#{user_id}"
    pos_sk = f"POS#{ticker}"

    current_pos = table.get_item(Key={"PK": pk, "SK": pos_sk}).get("Item")

    if current_pos:
        old_shares = current_pos["shares"]
        old_avg_usd = current_pos.get("avg_cost_usd", current_pos.get("avg_cost", Decimal("0")))
        # Retrocompatibilidade: se posição antiga não tinha avg_cost_eur, assume old_avg_usd
        old_avg_eur = current_pos.get("avg_cost_eur", old_avg_usd)
        first_buy_date = current_pos.get("first_buy_date", tx_date)
        existing_name = current_pos.get("name", "")

        if tx_type == "BUY":
            new_shares = old_shares + shares
            new_avg_usd = ((old_shares * old_avg_usd) + (shares * price_usd)) / new_shares
            new_avg_eur = ((old_shares * old_avg_eur) + (shares * price_eur)) / new_shares
            if tx_date < first_buy_date:
                first_buy_date = tx_date
        elif tx_type == "SELL":
            if shares > old_shares:
                return response(400, {
                    "error": f"Saldo insuficiente: tens {float(old_shares)} ações de {ticker} para vender."
                })
            new_shares = old_shares - shares
            new_avg_usd = old_avg_usd if new_shares > 0 else Decimal("0")
            new_avg_eur = old_avg_eur if new_shares > 0 else Decimal("0")
    else:
        if tx_type == "SELL":
            return response(400, {"error": f"Não tens posição aberta em {ticker} para vender."})
        new_shares = shares
        new_avg_usd = price_usd
        new_avg_eur = price_eur
        first_buy_date = tx_date
        existing_name = ""

    resolved_name = name or existing_name

    # 3. Atualizar (ou remover se liquidar) a posição agregada
    if new_shares == 0:
        table.delete_item(Key={"PK": pk, "SK": pos_sk})
    else:
        pos_item = {
            "PK": pk,
            "SK": pos_sk,
            "ticker": ticker,
            "shares": new_shares,
            "asset_currency": asset_currency,
            "avg_cost": round(new_avg_usd, 4),      # Mantido por compatibilidade
            "avg_cost_usd": round(new_avg_usd, 4),
            "avg_cost_eur": round(new_avg_eur, 4),
            "invested_usd": round(new_shares * new_avg_usd, 2),
            "invested_eur": round(new_shares * new_avg_eur, 2),
            "first_buy_date": first_buy_date,
            "updated_at": now_iso,
        }
        if resolved_name:
            pos_item["name"] = resolved_name

        table.put_item(Item=pos_item)

    # 4. Guardar o registo histórico imutável da transação
    tx_id = uuid.uuid4().hex[:8]
    tx_item = {
        "PK": pk,
        "SK": f"TX#{tx_date}#{ticker}#{tx_id}",
        "ticker": ticker,
        "type": tx_type,
        "shares": shares,
        "asset_currency": asset_currency,
        "base_currency": base_currency,
        "price": price_native,                      # Compatibilidade
        "price_native": price_native,
        "total_native": total_native,
        "exchange_rate": round(exchange_rate, 4),
        "total_base_currency": total_base_currency,
        "total_usd": total_usd,
        "total_eur": total_eur,
        "transaction_date": tx_date,
        "created_at": now_iso,
    }
    if resolved_name:
        tx_item["name"] = resolved_name

    table.put_item(Item=tx_item)

    # 5. Assegura que o ticker fica sob monitorização na Finnhub
    ensure_ticker_tracked(ticker, fallback_price=price_usd)

    return response(200, {
        "message": "Transação registada com sucesso.",
        "ticker": ticker,
        "type": tx_type,
        "transaction_date": tx_date,
        "total_shares": new_shares,
        "avg_cost": round(new_avg_usd, 2),
        "avg_cost_usd": round(new_avg_usd, 2),
        "avg_cost_eur": round(new_avg_eur, 2),
        "exchange_rate": round(exchange_rate, 4),
        "total_usd": total_usd,
        "total_eur": total_eur,
    })


def handle_get_portfolio(user_id):
    pk = f"USER#{user_id}"

    res = table.query(
        KeyConditionExpression=Key("PK").eq(pk) & Key("SK").begins_with("POS#")
    )
    items = res.get("Items", [])

    fx_rate_eur_usd = get_cached_eur_usd_rate()

    if not items:
        return response(200, {
            "user_id": user_id,
            "fx_rate_eur_usd": fx_rate_eur_usd,
            "total_value": 0,
            "total_invested": 0,
            "total_pnl_value": 0,
            "total_pnl_pct": 0,
            "total_value_eur": 0,
            "total_invested_eur": 0,
            "total_pnl_value_eur": 0,
            "total_pnl_pct_eur": 0,
            "positions": [],
        })

    # Busca todos os preços em cache numa única leitura
    market_res = table.query(
        KeyConditionExpression=Key("PK").eq("MARKET#PRICE") & Key("SK").begins_with("TICKER#")
    )
    market_map = {m["ticker"]: m for m in market_res.get("Items", [])}

    positions = []
    total_portfolio_value_usd = Decimal("0")
    total_invested_usd = Decimal("0")
    total_portfolio_value_eur = Decimal("0")
    total_invested_eur = Decimal("0")

    for item in items:
        ticker = item["ticker"]
        shares = item["shares"]
        asset_currency = item.get("asset_currency", "USD")

        avg_cost_usd = item.get("avg_cost_usd", item.get("avg_cost", Decimal("0")))
        # Para posições antigas criadas antes do suporte EUR, converte pela taxa atual como fallback
        avg_cost_eur = item.get(
            "avg_cost_eur",
            (avg_cost_usd / fx_rate_eur_usd) if fx_rate_eur_usd > 0 else avg_cost_usd
        )
        first_buy_date = item.get("first_buy_date")
        pos_name = item.get("name", "")

        price_item = market_map.get(ticker)
        if not price_item:
            price_item = ensure_ticker_tracked(ticker, fallback_price=avg_cost_usd)

        # Finnhub devolve cotações em USD
        current_price_usd = price_item["price"] if price_item else avg_cost_usd
        current_price_eur = (
            (current_price_usd / fx_rate_eur_usd) if fx_rate_eur_usd > 0 else current_price_usd
        )
        day_change_pct = price_item.get("change_pct", Decimal("0")) if price_item else Decimal("0")

        # Cálculos em USD
        market_value_usd = shares * current_price_usd
        invested_usd = shares * avg_cost_usd
        pnl_value_usd = market_value_usd - invested_usd
        pnl_pct_usd = (pnl_value_usd / invested_usd * 100) if invested_usd > 0 else Decimal("0")

        # Cálculos em EUR (com impacto cambial real face ao custo histórico em EUR)
        market_value_eur = shares * current_price_eur
        invested_eur = shares * avg_cost_eur
        pnl_value_eur = market_value_eur - invested_eur
        pnl_pct_eur = (pnl_value_eur / invested_eur * 100) if invested_eur > 0 else Decimal("0")

        total_portfolio_value_usd += market_value_usd
        total_invested_usd += invested_usd
        total_portfolio_value_eur += market_value_eur
        total_invested_eur += invested_eur

        pos_data = {
            "ticker": ticker,
            "shares": shares,
            "asset_currency": asset_currency,
            "avg_cost": round(avg_cost_usd, 2),
            "avg_cost_usd": round(avg_cost_usd, 2),
            "avg_cost_eur": round(avg_cost_eur, 2),
            "current_price": round(current_price_usd, 2),
            "current_price_usd": round(current_price_usd, 2),
            "current_price_eur": round(current_price_eur, 2),
            "day_change_pct": round(day_change_pct, 2),
            "invested_usd": round(invested_usd, 2),
            "invested_eur": round(invested_eur, 2),
            "market_value": round(market_value_usd, 2),
            "market_value_usd": round(market_value_usd, 2),
            "market_value_eur": round(market_value_eur, 2),
            "pnl_value": round(pnl_value_usd, 2),
            "pnl_value_usd": round(pnl_value_usd, 2),
            "pnl_value_eur": round(pnl_value_eur, 2),
            "pnl_pct": round(pnl_pct_usd, 2),
            "pnl_pct_usd": round(pnl_pct_usd, 2),
            "pnl_pct_eur": round(pnl_pct_eur, 2),
            "first_buy_date": first_buy_date,
        }
        if pos_name:
            pos_data["name"] = pos_name

        positions.append(pos_data)

    for pos in positions:
        pos_val_usd = Decimal(str(pos["market_value_usd"]))
        pos["allocation_pct"] = (
            round((pos_val_usd / total_portfolio_value_usd) * 100, 2)
            if total_portfolio_value_usd > 0
            else 0
        )

    total_pnl_usd = total_portfolio_value_usd - total_invested_usd
    total_pnl_pct_usd = (
        (total_pnl_usd / total_invested_usd * 100) if total_invested_usd > 0 else Decimal("0")
    )

    total_pnl_eur = total_portfolio_value_eur - total_invested_eur
    total_pnl_pct_eur = (
        (total_pnl_eur / total_invested_eur * 100) if total_invested_eur > 0 else Decimal("0")
    )

    return response(200, {
        "user_id": user_id,
        "fx_rate_eur_usd": fx_rate_eur_usd,
        "total_value": round(total_portfolio_value_usd, 2),
        "total_invested": round(total_invested_usd, 2),
        "total_pnl_value": round(total_pnl_usd, 2),
        "total_pnl_pct": round(total_pnl_pct_usd, 2),
        "total_value_eur": round(total_portfolio_value_eur, 2),
        "total_invested_eur": round(total_invested_eur, 2),
        "total_pnl_value_eur": round(total_pnl_eur, 2),
        "total_pnl_pct_eur": round(total_pnl_pct_eur, 2),
        "positions": positions,
    })