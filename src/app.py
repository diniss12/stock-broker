import os
import json
import uuid
import boto3
from decimal import Decimal
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["TABLE_NAME"])

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)

def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, cls=DecimalEncoder)
    }

def lambda_handler(event, context):
    route_key = event.get("routeKey")

    # Extrai as claims do token JWT validadas pelo API Gateway
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    
    # "sub" e o UUID fixo do utilizador no Cognito; em fallback usamos o username
    user_id = claims.get("sub") or claims.get("cognito:username")

    if not user_id:
        return response(401, {"error": "Nao autorizado: token em falta ou invalido"})

    if route_key == "POST /transaction":
        return handle_post_transaction(user_id, event.get("body"))
    elif route_key == "GET /portfolio":
        return handle_get_portfolio(user_id)
    
    return response(404, {"error": "Rota nao encontrada"})


def handle_post_transaction(user_id, raw_body):
    body = json.loads(raw_body or "{}")
    ticker = body["ticker"].upper().strip()
    tx_type = body.get("type", "BUY").upper().strip()
    shares = Decimal(str(body["shares"]))
    price = Decimal(str(body["price"]))
    
    now_iso = datetime.now(timezone.utc).isoformat()
    today_str = now_iso[:10] # Formato YYYY-MM-DD
    
    # Se o utilizador enviar "date" (ex: "2024-05-15"), usa essa data; caso contrario, usa hoje
    tx_date = body.get("date", today_str).strip()

    if shares <= 0 or price < 0:
        return response(400, {"error": "Quantidade e preco devem ser valores positivos"})

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
                    "error": f"Saldo insuficiente: tens {float(old_shares)} acoes de {ticker} para vender"
                })
            new_shares = old_shares - shares
            new_avg = old_avg if new_shares > 0 else Decimal("0")
        else:
            return response(400, {"error": "Tipo de transacao invalido (usa BUY ou SELL)"})
    else:
        if tx_type == "SELL":
            return response(400, {"error": f"Nao tens posicao aberta em {ticker} para vender"})
        new_shares = shares
        new_avg = price
        first_buy_date = tx_date

    # 1. Atualizar (ou remover se ficar a 0) a posicao agregada
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
            "updated_at": now_iso
        })

    # 2. Guardar o registo da transacao ordenado pela data da operacao + ID unico curto
    tx_id = uuid.uuid4().hex[:8]
    table.put_item(Item={
        "PK": pk,
        "SK": f"TX#{tx_date}#{ticker}#{tx_id}",
        "ticker": ticker,
        "type": tx_type,
        "shares": shares,
        "price": price,
        "transaction_date": tx_date,
        "created_at": now_iso
    })

    # 3. Atualizar o preco de referencia apenas se nao existir ou se a compra for recente
    existing_market = table.get_item(
        Key={"PK": "MARKET#PRICE", "SK": f"TICKER#{ticker}"}
    ).get("Item")
    
    last_price_date = existing_market.get("price_date", "0000-00-00") if existing_market else "0000-00-00"
    if tx_date >= last_price_date:
        table.put_item(Item={
            "PK": "MARKET#PRICE",
            "SK": f"TICKER#{ticker}",
            "price": price,
            "price_date": tx_date,
            "updated_at": now_iso
        })

    return response(200, {
        "message": "Transacao registada com sucesso",
        "ticker": ticker,
        "type": tx_type,
        "transaction_date": tx_date,
        "total_shares": new_shares,
        "avg_cost": round(new_avg, 2)
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
            "positions": []
        })

    positions = []
    total_portfolio_value = Decimal("0")
    total_invested = Decimal("0")

    for item in items:
        ticker = item["ticker"]
        shares = item["shares"]
        avg_cost = item["avg_cost"]
        first_buy_date = item.get("first_buy_date")

        price_item = table.get_item(
            Key={"PK": "MARKET#PRICE", "SK": f"TICKER#{ticker}"}
        ).get("Item")
        
        current_price = price_item["price"] if price_item else avg_cost

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
            "market_value": round(market_value, 2),
            "pnl_value": round(pnl_value, 2),
            "pnl_pct": round(pnl_pct, 2),
            "first_buy_date": first_buy_date
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
        "positions": positions
    })