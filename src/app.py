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
    impedindo corrupção de Sort Keys no DynamoDB e exceções 500 no runtime.
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

    # 4. Parsing numérico seguro com limites de grandeza
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

    # 5. Validação rigorosa de Data (formato YYYY-MM-DD e sem datas futuras)
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

    return True, {
        "ticker": raw_ticker,
        "type": tx_type,
        "shares": shares,
        "price": price,
        "date": tx_date,
    }


# ==========================================
# FUNÇÕES DE MERCADO E CACHE (FINNHUB)
# ==========================================

def fetch_finnhub_quote(ticker: str) -> dict | None:
    """Busca o preço atual, fecho anterior e variação diária na Finnhub."""
    # Garante ticker limpo antes da chamada externa
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
    """Handler chamado pelo EventBridge (ou manualmente) para atualizar todos os preços."""
    tickers = get_tracked_tickers()
    updated = []

    with table.batch_writer() as batch:
        for ticker in tickers:
            quote = fetch_finnhub_quote(ticker)
            if quote:
                batch.put_item(Item=quote)
                updated.append(quote)
            time.sleep(0.1)

    return response(200, {
        "message": "Cache de mercado atualizada com sucesso",
        "updated_count": len(updated),
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
    tx_type = validated_or_err["type"]
    shares = validated_or_err["shares"]
    price = validated_or_err["price"]
    tx_date = validated_or_err["date"]

    now_iso = datetime.now(timezone.utc).isoformat()
    pk = f"USER#{user_id}"
    pos_sk = f"POS#{ticker}"

    current_pos = table.get_item(Key={"PK": pk, "SK": pos_sk}).get("Item")

    if current_pos:
        old_shares = current_pos["shares"]
        old_avg = current_pos["avg_cost"]
        first_buy_date = current_pos.get("first_buy_date", tx_date)

        if tx_type == "BUY":
            new_shares = old_shares + shares
            new_avg = ((old_shares * old_avg) + (shares * price)) / new_shares
            if tx_date < first_buy_date:
                first_buy_date = tx_date
        elif tx_type == "SELL":
            if shares > old_shares:
                return response(400, {
                    "error": f"Saldo insuficiente: tens {float(old_shares)} ações de {ticker} para vender."
                })
            new_shares = old_shares - shares
            new_avg = old_avg if new_shares > 0 else Decimal("0")
    else:
        if tx_type == "SELL":
            return response(400, {"error": f"Não tens posição aberta em {ticker} para vender."})
        new_shares = shares
        new_avg = price
        first_buy_date = tx_date

    # 1. Atualizar (ou remover se liquidar) a posição agregada
    if new_shares == 0:
        table.delete_item(Key={"PK": pk, "SK": pos_sk})
    else:
        table.put_item(Item={
            "PK": pk,
            "SK": pos_sk,
            "ticker": ticker,
            "shares": new_shares,
            "avg_cost": round(new_avg, 4),
            "first_buy_date": first_buy_date,
            "updated_at": now_iso,
        })

    # 2. Guardar o registo da transação
    tx_id = uuid.uuid4().hex[:8]
    table.put_item(Item={
        "PK": pk,
        "SK": f"TX#{tx_date}#{ticker}#{tx_id}",
        "ticker": ticker,
        "type": tx_type,
        "shares": shares,
        "price": price,
        "transaction_date": tx_date,
        "created_at": now_iso,
    })

    # 3. Assegura que o ticker fica sob monitorização na Finnhub
    ensure_ticker_tracked(ticker, fallback_price=price)

    return response(200, {
        "message": "Transação registada com sucesso.",
        "ticker": ticker,
        "type": tx_type,
        "transaction_date": tx_date,
        "total_shares": new_shares,
        "avg_cost": round(new_avg, 2),
    })


def handle_get_portfolio(user_id):
    pk = f"USER#{user_id}"

    res = table.query(
        KeyConditionExpression=Key("PK").eq(pk) & Key("SK").begins_with("POS#")
    )
    items = res.get("Items", [])

    if not items:
        return response(200, {
            "user_id": user_id,
            "total_value": 0,
            "total_invested": 0,
            "total_pnl_value": 0,
            "total_pnl_pct": 0,
            "positions": [],
        })

    # Busca todos os preços em cache numa única leitura
    market_res = table.query(
        KeyConditionExpression=Key("PK").eq("MARKET#PRICE") & Key("SK").begins_with("TICKER#")
    )
    market_map = {m["ticker"]: m for m in market_res.get("Items", [])}

    positions = []
    total_portfolio_value = Decimal("0")
    total_invested = Decimal("0")

    for item in items:
        ticker = item["ticker"]
        shares = item["shares"]
        avg_cost = item["avg_cost"]
        first_buy_date = item.get("first_buy_date")

        price_item = market_map.get(ticker)
        if not price_item:
            price_item = ensure_ticker_tracked(ticker, fallback_price=avg_cost)

        current_price = price_item["price"] if price_item else avg_cost
        day_change_pct = price_item.get("change_pct", Decimal("0")) if price_item else Decimal("0")

        market_value = shares * current_price
        invested = shares * avg_cost
        pnl_value = market_value - invested
        pnl_pct = (pnl_value / invested * 100) if invested > 0 else Decimal("0")

        total_portfolio_value += market_value
        total_invested += invested

        positions.append({
            "ticker": ticker,
            "shares": shares,
            "avg_cost": round(avg_cost, 2),
            "current_price": round(current_price, 2),
            "day_change_pct": round(day_change_pct, 2),
            "market_value": round(market_value, 2),
            "pnl_value": round(pnl_value, 2),
            "pnl_pct": round(pnl_pct, 2),
            "first_buy_date": first_buy_date,
        })

    for pos in positions:
        pos_val = Decimal(str(pos["market_value"]))
        pos["allocation_pct"] = round((pos_val / total_portfolio_value) * 100, 2) if total_portfolio_value > 0 else 0

    total_pnl = total_portfolio_value - total_invested
    total_pnl_pct = (total_pnl / total_invested * 100) if total_invested > 0 else Decimal("0")

    return response(200, {
        "user_id": user_id,
        "total_value": round(total_portfolio_value, 2),
        "total_invested": round(total_invested, 2),
        "total_pnl_value": round(total_pnl, 2),
        "total_pnl_pct": round(total_pnl_pct, 2),
        "positions": positions,
    })