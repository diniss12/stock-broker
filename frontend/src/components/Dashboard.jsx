import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchAuthSession } from "aws-amplify/auth";

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  "https://7yu2kb0zrj.execute-api.eu-west-1.amazonaws.com";

const PALETTE = [
  "#f97316", "#10b981", "#3b82f6", "#ef4444", "#06b6d4",
  "#14b8a6", "#ec4899", "#eab308", "#8b5cf6", "#6366f1"
];

const COMPANY_NAMES = {
  NVDA: "NVIDIA Corp.",
  AMZN: "Amazon.com",
  AAPL: "Apple Inc.",
  GOOGL: "Alphabet Inc.",
  MSFT: "Microsoft Corp.",
  TSLA: "Tesla Inc.",
  META: "Meta Platforms",
  "BRK.B": "Berkshire Hathaway",
  TSM: "Taiwan Semiconductor",
  AVGO: "Broadcom Inc.",
  JPM: "JPMorgan Chase",
  V: "Visa Inc.",
  BABA: "Alibaba Group",
  BIDU: "Baidu Inc.",
  JD: "JD.com Inc.",
  MOH: "Molina Healthcare",
  PDD: "PDD Holdings",
  SOFI: "SoFi Technologies",
  FICO: "Fair Isaac Corp.",
};

function StockLogo({ ticker, size = 32, borderRadius = 8 }) {
  const cleanTicker = encodeURIComponent(ticker);
  const primarySrc = `https://assets.parqet.com/logos/symbol/${cleanTicker}?format=png`;
  const fallbackSrc = `https://ui-avatars.com/api/?name=${cleanTicker}&background=18181b&color=fafafa&size=64&font-size=0.4&bold=true`;

  return (
    <img
      src={primarySrc}
      alt={ticker}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${borderRadius}px`,
        objectFit: "cover",
        display: "block",
        flexShrink: 0,
      }}
      onError={(e) => {
        e.currentTarget.onerror = null;
        e.currentTarget.src = fallbackSrc;
      }}
    />
  );
}

function polarToCartesian(cx, cy, r, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians),
  };
}

function createDonutSlicePath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const safeEnd = endAngle - startAngle >= 360 ? startAngle + 359.99 : endAngle;
  const startOuter = polarToCartesian(cx, cy, rOuter, safeEnd);
  const endOuter = polarToCartesian(cx, cy, rOuter, startAngle);
  const startInner = polarToCartesian(cx, cy, rInner, safeEnd);
  const endInner = polarToCartesian(cx, cy, rInner, startAngle);
  const largeArcFlag = safeEnd - startAngle <= 180 ? "0" : "1";

  return [
    "M", startOuter.x, startOuter.y,
    "A", rOuter, rOuter, 0, largeArcFlag, 0, endOuter.x, endOuter.y,
    "L", endInner.x, endInner.y,
    "A", rInner, rInner, 0, largeArcFlag, 1, startInner.x, startInner.y,
    "Z",
  ].join(" ");
}

function formatCompactCurrency(val) {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function formatMoney(val) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val || 0);
}

export default function Dashboard({ user, onLogout }) {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState("");
  const [hoveredTicker, setHoveredTicker] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [txType, setTxType] = useState("BUY");
  const [txTicker, setTxTicker] = useState("");
  const [txName, setTxName] = useState("");
  const [txShares, setTxShares] = useState("");
  const [txPrice, setTxPrice] = useState("");
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));

  const getJwtToken = async () => {
    const session = await fetchAuthSession();
    return (
      session.tokens?.idToken?.toString() ||
      session.tokens?.accessToken?.toString()
    );
  };

  const fetchPortfolio = useCallback(async () => {
    try {
      const token = await getJwtToken();
      const res = await fetch(`${API_BASE_URL}/portfolio`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Erro ao carregar carteira (${res.status})`);
      }

      const data = await res.json();
      setPositions(Array.isArray(data.positions) ? data.positions : []);
    } catch (err) {
      console.error("Erro ao carregar carteira:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
    const interval = setInterval(fetchPortfolio, 180000);
    return () => clearInterval(interval);
  }, [fetchPortfolio]);

  const portfolio = useMemo(() => {
    let totalValue = 0;
    let totalInvested = 0;
    let dayChangeDollar = 0;

    const enriched = positions.map((p, idx) => {
      const shares = Number(p.shares || 0);
      const avgCost = Number(p.avg_cost || 0);
      const currentPrice = Number(p.current_price || avgCost);
      const dayChangePct = Number(p.day_change_pct || 0);

      const marketValue = shares * currentPrice;
      const invested = shares * avgCost;
      const pnlValue = marketValue - invested;
      const pnlPct = invested > 0 ? (pnlValue / invested) * 100 : 0;
      const posDayChange = marketValue * (dayChangePct / 100);

      totalValue += marketValue;
      totalInvested += invested;
      dayChangeDollar += posDayChange;

      return {
        ...p,
        ticker: p.ticker,
        name: p.name || COMPANY_NAMES[p.ticker] || `${p.ticker} Equity`,
        shares,
        avg_cost: avgCost,
        current_price: currentPrice,
        day_change_pct: dayChangePct,
        color: PALETTE[idx % PALETTE.length],
        market_value: marketValue,
        invested,
        pnl_value: pnlValue,
        pnl_pct: pnlPct,
      };
    });

    enriched.sort((a, b) => b.market_value - a.market_value);

    let currentAngle = 0;
    const withAllocation = enriched.map((p, idx) => {
      const assignedColor = PALETTE[idx % PALETTE.length];
      const allocationPct = totalValue > 0 ? (p.market_value / totalValue) * 100 : 0;
      const sliceAngle = (allocationPct / 100) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;
      const midAngle = startAngle + sliceAngle / 2;
      currentAngle = endAngle;

      return {
        ...p,
        color: assignedColor,
        allocation_pct: allocationPct,
        startAngle,
        endAngle,
        midAngle,
      };
    });

    const totalPnlValue = totalValue - totalInvested;
    const totalPnlPct = totalInvested > 0 ? (totalPnlValue / totalInvested) * 100 : 0;
    const dayChangePct = totalValue > 0 ? (dayChangeDollar / totalValue) * 100 : 0;

    return {
      totalValue,
      totalInvested,
      totalPnlValue,
      totalPnlPct,
      dayChangeDollar,
      dayChangePct,
      items: withAllocation,
    };
  }, [positions]);

  const activeCenterItem = useMemo(() => {
    if (!portfolio.items.length) return null;
    if (hoveredTicker) {
      return portfolio.items.find((i) => i.ticker === hoveredTicker) || portfolio.items[0];
    }
    return portfolio.items[0];
  }, [portfolio, hoveredTicker]);

  async function handleTransactionSubmit(e) {
    e.preventDefault();
    setApiError("");
    setSubmitting(true);

    const cleanSymbol = txTicker.trim().toUpperCase();
    const numShares = parseFloat(txShares);
    const numPrice = parseFloat(txPrice);

    try {
      if (txName.trim()) {
        COMPANY_NAMES[cleanSymbol] = txName.trim();
      }

      const token = await getJwtToken();
      const res = await fetch(`${API_BASE_URL}/transaction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ticker: cleanSymbol,
          type: txType,
          shares: numShares,
          price: numPrice,
          date: txDate,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao registar operação.");
      }

      await fetchPortfolio();
      setTxTicker("");
      setTxName("");
      setTxShares("");
      setTxPrice("");
      setIsModalOpen(false);
    } catch (err) {
      setApiError(err.message || "Falha ao comunicar com o servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  const maxPositionValue =
    portfolio.items.length > 0 ? portfolio.items[0].market_value : 1;

  return (
    <div style={styles.page}>
      {/* Fundo discreto com grelha e curvas */}
      <svg
        viewBox="0 0 1440 900"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={styles.bgSvg}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="dashGreenArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.08" />
            <stop offset="70%" stopColor="#0f172a" stopOpacity="0.02" />
            <stop offset="100%" stopColor="#090d0b" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="dashGreenStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#10b981" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        <g stroke="rgba(255,255,255,0.015)" strokeWidth="1">
          <line x1="0" y1="180" x2="1440" y2="180" />
          <line x1="0" y1="360" x2="1440" y2="360" />
          <line x1="0" y1="540" x2="1440" y2="540" />
          <line x1="0" y1="720" x2="1440" y2="720" />
          <line x1="288" y1="0" x2="288" y2="900" />
          <line x1="576" y1="0" x2="576" y2="900" />
          <line x1="864" y1="0" x2="864" y2="900" />
          <line x1="1152" y1="0" x2="1152" y2="900" />
        </g>

        <path
          d="M-50 740 C 180 710, 290 540, 470 560 C 650 580, 740 390, 920 410 C 1100 430, 1200 220, 1490 170 L 1490 950 L -50 950 Z"
          fill="url(#dashGreenArea)"
        />
        <path
          d="M-50 740 C 180 710, 290 540, 470 560 C 650 580, 740 390, 920 410 C 1100 430, 1200 220, 1490 170"
          stroke="url(#dashGreenStroke)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>

      {/* Barra de Topo */}
      <header style={styles.navbar}>
        <div style={styles.navBrand}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 17L9 11L13 15L21 7"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M15 7H21V13"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span style={styles.brandText}>StockBroker</span>
        </div>

        <div style={styles.navActions}>
          <button
            type="button"
            onClick={() => {
              setApiError("");
              setIsModalOpen(true);
            }}
            style={styles.primaryBtn}
          >
            + Nova Operação
          </button>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              style={styles.secondaryBtn}
            >
              Terminar Sessão
            </button>
          )}
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main style={styles.container}>
        {/* 1. KPIs DE RESUMO ALINHADOS */}
        <section style={styles.kpiGrid}>
          <div style={styles.kpiCard}>
            <span style={styles.kpiLabel}>VALOR TOTAL DA CARTEIRA</span>
            <div style={styles.kpiCenterRow}>
              <span style={styles.kpiBigValue}>
                {formatMoney(portfolio.totalValue)}
              </span>
              {portfolio.items.length > 0 && (
                <span
                  style={{
                    ...styles.kpiPill,
                    color: portfolio.dayChangeDollar >= 0 ? "#10b981" : "#ef4444",
                    backgroundColor:
                      portfolio.dayChangeDollar >= 0
                        ? "rgba(16, 185, 129, 0.14)"
                        : "rgba(239, 68, 68, 0.14)",
                  }}
                >
                  {portfolio.dayChangeDollar >= 0 ? "▲" : "▼"}{" "}
                  {Math.abs(portfolio.dayChangePct).toFixed(2)}%
                </span>
              )}
            </div>
            <span style={styles.kpiSub}>
              {portfolio.items.length} posições ativas em carteira
            </span>
          </div>

          <div style={styles.kpiCard}>
            <span style={styles.kpiLabel}>CAPITAL TOTAL INVESTIDO</span>
            <div style={styles.kpiCenterRow}>
              <span style={styles.kpiBigValue}>
                {formatMoney(portfolio.totalInvested)}
              </span>
            </div>
            <span style={styles.kpiSub}>Custo médio ponderado acumulado</span>
          </div>

          <div style={styles.kpiCard}>
            <span style={styles.kpiLabel}>RENTABILIDADE TOTAL (P&L)</span>
            <div style={styles.kpiCenterRow}>
              <span
                style={{
                  ...styles.kpiBigValue,
                  color: portfolio.totalPnlValue >= 0 ? "#10b981" : "#ef4444",
                }}
              >
                {portfolio.totalPnlValue >= 0 ? "+" : ""}
                {formatMoney(portfolio.totalPnlValue)}
              </span>
              {portfolio.items.length > 0 && (
                <span
                  style={{
                    ...styles.kpiPill,
                    color: portfolio.totalPnlPct >= 0 ? "#10b981" : "#ef4444",
                    backgroundColor:
                      portfolio.totalPnlPct >= 0
                        ? "rgba(16, 185, 129, 0.14)"
                        : "rgba(239, 68, 68, 0.14)",
                  }}
                >
                  {portfolio.totalPnlPct >= 0 ? "+" : ""}
                  {portfolio.totalPnlPct.toFixed(2)}%
                </span>
              )}
            </div>
            <span style={styles.kpiSub}>
              Retorno líquido sobre o capital investido
            </span>
          </div>

          <div style={styles.kpiCard}>
            <span style={styles.kpiLabel}>MAIOR EXPOSIÇÃO (TOP HOLDING)</span>
            {portfolio.items[0] ? (
              <>
                <div style={styles.kpiCenterRow}>
                  <StockLogo
                    ticker={portfolio.items[0].ticker}
                    size={34}
                    borderRadius={8}
                  />
                  <span style={styles.kpiBigValue}>
                    {portfolio.items[0].ticker}
                  </span>
                  <span
                    style={{
                      ...styles.kpiPill,
                      color: "#10b981",
                      backgroundColor: "rgba(16, 185, 129, 0.14)",
                    }}
                  >
                    {portfolio.items[0].allocation_pct.toFixed(1)}%
                  </span>
                </div>
                <span style={styles.kpiSub}>
                  {portfolio.items[0].name} ·{" "}
                  {formatMoney(portfolio.items[0].market_value)}
                </span>
              </>
            ) : (
              <>
                <div style={styles.kpiCenterRow}>
                  <span style={styles.kpiBigValue}>---</span>
                </div>
                <span style={styles.kpiSub}>Sem posições ativas</span>
              </>
            )}
          </div>
        </section>

        {loading ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>A carregar posições da tua carteira...</p>
          </div>
        ) : portfolio.items.length === 0 ? (
          <div style={styles.emptyCard}>
            <h3 style={styles.emptyTitle}>A tua carteira ainda está vazia</h3>
            <p style={styles.emptyText}>
              Regista a tua primeira compra para visualizar o gráfico de alocação,
              a exposição por ativo e a rentabilidade em tempo real.
            </p>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              style={{ ...styles.primaryBtn, marginTop: "0.75rem" }}
            >
              + Registar Primeira Compra
            </button>
          </div>
        ) : (
          <>
            {/* 2. DONUT CHART + RANKING DE BARRAS */}
            <section style={styles.visualGrid}>
              <div style={styles.panelCard}>
                <div style={styles.panelHeader}>
                  <h2 style={styles.panelTitle}>
                    Alocação da Carteira (Top Holdings)
                  </h2>
                </div>

                <div style={styles.donutContainer}>
                  <svg
                    viewBox="0 0 500 500"
                    style={{
                      width: "100%",
                      maxWidth: "450px",
                      height: "auto",
                      overflow: "visible",
                    }}
                  >
                    <defs>
                      <clipPath id="cleanLogoClip">
                        <rect x="-18" y="-18" width="36" height="36" rx="8" />
                      </clipPath>
                    </defs>

                    {portfolio.items.map((slice) => {
                      const isHovered = hoveredTicker === slice.ticker;
                      const rOuter = isHovered ? 175 : 168;
                      const rInner = 92;
                      const pathData = createDonutSlicePath(
                        250,
                        250,
                        rOuter,
                        rInner,
                        slice.startAngle,
                        slice.endAngle
                      );

                      const pctPos = polarToCartesian(
                        250,
                        250,
                        132,
                        slice.midAngle
                      );
                      const badgePos = polarToCartesian(
                        250,
                        250,
                        210,
                        slice.midAngle
                      );
                      const cleanTicker = encodeURIComponent(slice.ticker);
                      const logoUrl = `https://assets.parqet.com/logos/symbol/${cleanTicker}?format=png`;

                      return (
                        <g
                          key={slice.ticker}
                          onMouseEnter={() => setHoveredTicker(slice.ticker)}
                          onMouseLeave={() => setHoveredTicker(null)}
                          style={{ cursor: "pointer" }}
                        >
                          <path
                            d={pathData}
                            fill={slice.color}
                            stroke="#0d1512"
                            strokeWidth="3"
                            opacity={hoveredTicker && !isHovered ? 0.55 : 1}
                          />

                          {slice.allocation_pct >= 4.2 && (
                            <text
                              x={pctPos.x}
                              y={pctPos.y}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fill="#ffffff"
                              style={{
                                fontFamily: "'Inter', sans-serif",
                                fontSize:
                                  slice.allocation_pct > 10 ? "13.5px" : "11.5px",
                                fontWeight: 700,
                                pointerEvents: "none",
                              }}
                            >
                              {slice.allocation_pct.toFixed(1)}%
                            </text>
                          )}

                          {slice.allocation_pct >= 3.5 && (
                            <g
                              transform={`translate(${badgePos.x}, ${badgePos.y})`}
                            >
                              <image
                                href={logoUrl}
                                x="-18"
                                y="-18"
                                width="36"
                                height="36"
                                clipPath="url(#cleanLogoClip)"
                                preserveAspectRatio="xMidYMid slice"
                              />
                              <text
                                x="0"
                                y="31"
                                textAnchor="middle"
                                fill="#f4f4f5"
                                style={{
                                  fontFamily: "'Inter', sans-serif",
                                  fontSize: "11.5px",
                                  fontWeight: 700,
                                  letterSpacing: "-0.01em",
                                }}
                              >
                                {slice.ticker}
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                    <circle
                      cx="250"
                      cy="250"
                      r="86"
                      fill="#0b120f"
                      stroke="#1f2e28"
                      strokeWidth="1.5"
                    />

                    {activeCenterItem && (
                      <g>
                        <text
                          x="250"
                          y="218"
                          textAnchor="middle"
                          fill="#8e959e"
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: "9.5px",
                            fontWeight: 600,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                          }}
                        >
                          {hoveredTicker
                            ? "POSIÇÃO SELECIONADA"
                            : "MAIOR POSIÇÃO"}
                        </text>
                        <text
                          x="250"
                          y="246"
                          textAnchor="middle"
                          fill="#ffffff"
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: "24px",
                            fontWeight: 700,
                            letterSpacing: "-0.025em",
                          }}
                        >
                          {activeCenterItem.ticker}
                        </text>
                        <text
                          x="250"
                          y="270"
                          textAnchor="middle"
                          fill={activeCenterItem.color}
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: "15.5px",
                            fontWeight: 700,
                          }}
                        >
                          {activeCenterItem.allocation_pct.toFixed(1)}%
                        </text>
                        <text
                          x="250"
                          y="292"
                          textAnchor="middle"
                          fill="#a1a1aa"
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: "12px",
                            fontWeight: 500,
                          }}
                        >
                          {formatMoney(activeCenterItem.market_value)}
                        </text>
                      </g>
                    )}
                  </svg>
                </div>
              </div>

              <div style={styles.panelCard}>
                <div style={styles.panelHeader}>
                  <h2 style={styles.panelTitle}>Carteira por Valor de Mercado</h2>
                </div>

                <div style={styles.barsList}>
                  {portfolio.items.map((item) => {
                    const widthPct = Math.max(
                      (item.market_value / maxPositionValue) * 100,
                      15
                    );
                    const isHovered = hoveredTicker === item.ticker;

                    return (
                      <div
                        key={item.ticker}
                        style={{
                          ...styles.barRow,
                          backgroundColor: isHovered ? "#14201b" : "transparent",
                        }}
                        onMouseEnter={() => setHoveredTicker(item.ticker)}
                        onMouseLeave={() => setHoveredTicker(null)}
                      >
                        <div style={styles.barCompanyCol}>
                          <StockLogo
                            ticker={item.ticker}
                            size={34}
                            borderRadius={8}
                          />
                          <div style={styles.barCompanyText}>
                            <span style={styles.barCompanyName}>{item.name}</span>
                            <span style={styles.barCompanyShares}>
                              {item.shares} ações ·{" "}
                              {item.allocation_pct.toFixed(1)}%
                            </span>
                          </div>
                        </div>

                        <div style={styles.barTrackArea}>
                          <div
                            style={{
                              ...styles.barFillSolid,
                              width: `${widthPct}%`,
                              backgroundColor: isHovered ? "#263830" : "#182620",
                              borderColor: isHovered ? "#375247" : "#22352d",
                            }}
                          >
                            <span style={styles.barInnerTicker}>
                              ${item.ticker}
                            </span>
                          </div>
                          <span style={styles.barValueLabel}>
                            {formatCompactCurrency(item.market_value)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* 3. TABELA DE POSIÇÕES */}
            <section style={styles.tableCard}>
              <div style={styles.panelHeader}>
                <h2 style={styles.panelTitle}>
                  Posições Ativas & Rentabilidade
                </h2>
              </div>

              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.theadRow}>
                      <th style={styles.th}>ATIVO</th>
                      <th style={styles.thRight}>QUANTIDADE</th>
                      <th style={styles.thRight}>PREÇO MÉDIO</th>
                      <th style={styles.thRight}>PREÇO ATUAL</th>
                      <th style={styles.thRight}>VAR. DIÁRIA</th>
                      <th style={styles.thRight}>VALOR MERCADO</th>
                      <th style={styles.thRight}>LUCRO / P&L ($)</th>
                      <th style={styles.thRight}>ALOCAÇÃO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.items.map((item) => {
                      const isProfit = item.pnl_value >= 0;
                      const isDayUp = item.day_change_pct >= 0;

                      return (
                        <tr
                          key={item.ticker}
                          style={styles.tr}
                          onMouseEnter={() => setHoveredTicker(item.ticker)}
                          onMouseLeave={() => setHoveredTicker(null)}
                        >
                          <td style={styles.tdAsset}>
                            <StockLogo
                              ticker={item.ticker}
                              size={32}
                              borderRadius={8}
                            />
                            <div>
                              <div style={styles.tdTicker}>{item.ticker}</div>
                              <div style={styles.tdName}>{item.name}</div>
                            </div>
                          </td>

                          <td style={styles.tdRight}>{item.shares}</td>
                          <td style={styles.tdRight}>
                            ${item.avg_cost.toFixed(2)}
                          </td>
                          <td
                            style={{
                              ...styles.tdRight,
                              fontWeight: 600,
                              color: "#fff",
                            }}
                          >
                            ${item.current_price.toFixed(2)}
                          </td>

                          <td style={styles.tdRight}>
                            <span
                              style={{
                                ...styles.tableBadge,
                                color: isDayUp ? "#10b981" : "#ef4444",
                                backgroundColor: isDayUp
                                  ? "rgba(16, 185, 129, 0.14)"
                                  : "rgba(239, 68, 68, 0.14)",
                              }}
                            >
                              {isDayUp ? "+" : ""}
                              {item.day_change_pct.toFixed(2)}%
                            </span>
                          </td>

                          <td
                            style={{
                              ...styles.tdRight,
                              fontWeight: 600,
                              color: "#f8fafc",
                            }}
                          >
                            {formatMoney(item.market_value)}
                          </td>

                          <td style={styles.tdRight}>
                            <div
                              style={{
                                color: isProfit ? "#10b981" : "#ef4444",
                                fontWeight: 600,
                              }}
                            >
                              {isProfit ? "+" : ""}
                              {formatMoney(item.pnl_value)}
                            </div>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: isProfit ? "#34d399" : "#f87171",
                              }}
                            >
                              ({isProfit ? "+" : ""}
                              {item.pnl_pct.toFixed(2)}%)
                            </div>
                          </td>

                          <td style={styles.tdRight}>
                            <div style={styles.allocCell}>
                              <span>{item.allocation_pct.toFixed(1)}%</span>
                              <div style={styles.miniBarBg}>
                                <div
                                  style={{
                                    width: `${Math.min(
                                      item.allocation_pct,
                                      100
                                    )}%`,
                                    height: "100%",
                                    backgroundColor: "#64748b",
                                    borderRadius: "3px",
                                  }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>

      {/* Modal para Registar Operação */}
      {isModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Nova Operação</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>

            {apiError && <div style={styles.errorBox}>{apiError}</div>}

            <div style={styles.typeSwitch}>
              <button
                type="button"
                onClick={() => setTxType("BUY")}
                style={{
                  ...styles.switchBtn,
                  backgroundColor: txType === "BUY" ? "#059669" : "#141f1b",
                  borderColor: txType === "BUY" ? "#10b981" : "#23352e",
                  color: txType === "BUY" ? "#ffffff" : "#a1a1aa",
                }}
              >
                Compra (BUY)
              </button>
              <button
                type="button"
                onClick={() => setTxType("SELL")}
                style={{
                  ...styles.switchBtn,
                  backgroundColor: txType === "SELL" ? "#dc2626" : "#141f1b",
                  borderColor: txType === "SELL" ? "#ef4444" : "#23352e",
                  color: txType === "SELL" ? "#ffffff" : "#a1a1aa",
                }}
              >
                Venda (SELL)
              </button>
            </div>

            <form onSubmit={handleTransactionSubmit} style={styles.modalForm}>
              <div style={styles.formRow}>
                <div style={styles.field}>
                  <label style={styles.label}>TICKER</label>
                  <input
                    type="text"
                    required
                    placeholder="NVDA"
                    value={txTicker}
                    onChange={(e) => setTxTicker(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>NOME (OPCIONAL)</label>
                  <input
                    type="text"
                    placeholder="NVIDIA Corp."
                    value={txName}
                    onChange={(e) => setTxName(e.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={styles.formRow}>
                <div style={styles.field}>
                  <label style={styles.label}>QUANTIDADE</label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="10"
                    value={txShares}
                    onChange={(e) => setTxShares(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>PREÇO UNITÁRIO ($)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="142.50"
                    value={txPrice}
                    onChange={(e) => setTxPrice(e.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>DATA DA OPERAÇÃO</label>
                <input
                  type="date"
                  required
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  style={styles.input}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={styles.submitModalBtn}
              >
                {submitting
                  ? "A guardar..."
                  : `Confirmar ${txType === "BUY" ? "Compra" : "Venda"}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    position: "relative",
    minHeight: "100vh",
    width: "100%",
    background:
      "radial-gradient(circle at 50% 15%, #0f1714 0%, #090e0c 60%, #060908 100%)",
    color: "#ffffff",
    fontFamily: "'Inter', sans-serif",
    paddingBottom: "4rem",
  },
  bgSvg: {
    position: "fixed",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 0,
  },
  navbar: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 2.5rem",
    backgroundColor: "#0a120f",
    borderBottom: "1px solid #1c2e26",
  },
  navBrand: {
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
  },
  brandText: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "1.2rem",
    fontWeight: 700,
    color: "#ffffff",
    letterSpacing: "-0.03em",
  },
  navActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  primaryBtn: {
    padding: "0.56rem 1.15rem",
    borderRadius: "8px",
    backgroundColor: "#059669",
    border: "1px solid #10b981",
    color: "#ffffff",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.86rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondaryBtn: {
    padding: "0.56rem 1.05rem",
    borderRadius: "8px",
    backgroundColor: "#121f1a",
    border: "1px solid #23382f",
    color: "#cbd5e1",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.85rem",
    fontWeight: 500,
    cursor: "pointer",
  },
  container: {
    position: "relative",
    zIndex: 1,
    maxWidth: "1360px",
    margin: "0 auto",
    padding: "2rem 2.5rem 0",
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "1.2rem",
  },
  kpiCard: {
    height: "148px",
    padding: "1.35rem 1.5rem",
    borderRadius: "14px",
    backgroundColor: "#0d1613",
    border: "1px solid #1e3028",
    display: "grid",
    gridTemplateRows: "20px 1fr 20px",
    alignItems: "center",
  },
  kpiLabel: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.73rem",
    fontWeight: 600,
    color: "#94a3b8",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    alignSelf: "start",
  },
  kpiCenterRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
    alignSelf: "center",
    minWidth: 0,
  },
  kpiBigValue: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "1.88rem",
    fontWeight: 700,
    color: "#ffffff",
    letterSpacing: "-0.03em",
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  kpiPill: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.74rem",
    fontWeight: 600,
    padding: "0.22rem 0.5rem",
    borderRadius: "6px",
    whiteSpace: "nowrap",
  },
  kpiSub: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.81rem",
    color: "#8e959e",
    alignSelf: "end",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  emptyCard: {
    padding: "3.5rem 2rem",
    borderRadius: "16px",
    backgroundColor: "#0d1613",
    border: "1px solid #1e3028",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.6rem",
  },
  emptyTitle: {
    fontSize: "1.2rem",
    fontWeight: 600,
    color: "#ffffff",
  },
  emptyText: {
    fontSize: "0.9rem",
    color: "#8e959e",
    maxWidth: "460px",
    lineHeight: 1.5,
  },
  visualGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1.15fr",
    gap: "1.5rem",
    alignItems: "stretch",
  },
  panelCard: {
    padding: "1.6rem 1.8rem",
    borderRadius: "16px",
    backgroundColor: "#0d1613",
    border: "1px solid #1e3028",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: "1rem",
    marginBottom: "1rem",
    borderBottom: "1px solid #1a2923",
  },
  panelTitle: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "1.18rem",
    fontWeight: 600,
    color: "#ffffff",
    letterSpacing: "-0.02em",
  },
  donutContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.5rem 0",
    flex: 1,
  },
  barsList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    justifyContent: "center",
    flex: 1,
  },
  barRow: {
    display: "grid",
    gridTemplateColumns: "195px 1fr",
    alignItems: "center",
    gap: "1rem",
    padding: "0.38rem 0.55rem",
    borderRadius: "8px",
    cursor: "pointer",
  },
  barCompanyCol: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    minWidth: 0,
  },
  barCompanyText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  barCompanyName: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#f4f4f5",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  barCompanyShares: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.78rem",
    color: "#8e959e",
  },
  barTrackArea: {
    display: "flex",
    alignItems: "center",
    gap: "0.85rem",
    width: "100%",
  },
  barFillSolid: {
    height: "34px",
    borderRadius: "7px",
    border: "1px solid #22352d",
    display: "flex",
    alignItems: "center",
    paddingLeft: "0.75rem",
  },
  barInnerTicker: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.77rem",
    fontWeight: 600,
    color: "#e4e4e7",
  },
  barValueLabel: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.95rem",
    fontWeight: 700,
    letterSpacing: "-0.015em",
    color: "#ffffff",
    whiteSpace: "nowrap",
  },
  tableCard: {
    padding: "1.6rem 1.8rem",
    borderRadius: "16px",
    backgroundColor: "#0d1613",
    border: "1px solid #1e3028",
  },
  tableWrapper: {
    width: "100%",
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
  },
  theadRow: {
    borderBottom: "1px solid #1a2923",
  },
  th: {
    padding: "0.85rem 0.75rem",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "#8e959e",
    letterSpacing: "0.04em",
  },
  thRight: {
    padding: "0.85rem 0.75rem",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "#8e959e",
    letterSpacing: "0.04em",
    textAlign: "right",
  },
  tr: {
    borderBottom: "1px solid #14221d",
  },
  tdAsset: {
    padding: "0.95rem 0.75rem",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  tdTicker: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.94rem",
    fontWeight: 700,
    color: "#ffffff",
  },
  tdName: {
    fontSize: "0.8rem",
    color: "#8e959e",
  },
  tdRight: {
    padding: "0.95rem 0.75rem",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.9rem",
    color: "#d4d4d8",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  tableBadge: {
    fontFamily: "'JetBrains Mono', monospace",
    padding: "0.2rem 0.5rem",
    borderRadius: "5px",
    fontSize: "0.78rem",
    fontWeight: 600,
  },
  allocCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "0.3rem",
  },
  miniBarBg: {
    width: "72px",
    height: "5px",
    backgroundColor: "#182620",
    borderRadius: "3px",
    overflow: "hidden",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  modalCard: {
    width: "100%",
    maxWidth: "460px",
    boxSizing: "border-box",
    backgroundColor: "#0e1714",
    border: "1px solid #23382f",
    borderRadius: "16px",
    padding: "2rem",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1.25rem",
  },
  modalTitle: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "#ffffff",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#a1a1aa",
    fontSize: "1.05rem",
    cursor: "pointer",
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.16)",
    border: "1px solid rgba(239, 68, 68, 0.45)",
    color: "#fecaca",
    padding: "0.65rem 0.85rem",
    borderRadius: "8px",
    fontSize: "0.82rem",
    marginBottom: "1rem",
    lineHeight: 1.4,
  },
  typeSwitch: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.6rem",
    marginBottom: "1.3rem",
  },
  switchBtn: {
    padding: "0.65rem",
    borderRadius: "8px",
    border: "1px solid #23352e",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  modalForm: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  formRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.85rem",
    width: "100%",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    minWidth: 0,
  },
  label: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "#d4d4d8",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    height: "42px",
    padding: "0 0.85rem",
    borderRadius: "7px",
    border: "1px solid #23382f",
    backgroundColor: "#080e0c",
    color: "#ffffff",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.92rem",
    outline: "none",
  },
  submitModalBtn: {
    marginTop: "0.5rem",
    height: "44px",
    borderRadius: "8px",
    backgroundColor: "#059669",
    border: "1px solid #10b981",
    color: "#ffffff",
    fontFamily: "'Inter', sans-serif",
    fontWeight: 600,
    fontSize: "0.92rem",
    cursor: "pointer",
  },
};