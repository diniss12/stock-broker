import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { fetchAuthSession } from "aws-amplify/auth";

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  "https://7yu2kb0zrj.execute-api.eu-west-1.amazonaws.com";

const PALETTE = [
  "#f97316", "#10b981", "#3b82f6", "#ef4444", "#06b6d4",
  "#14b8a6", "#ec4899", "#eab308", "#8b5cf6", "#6366f1"
];

const EUR_SUFFIXES = [".DE", ".AS", ".LS", ".PA", ".MC", ".MI", ".BR"];

function isEuropeanEurTicker(sym = "") {
  const upper = sym.toUpperCase();
  return EUR_SUFFIXES.some((suf) => upper.endsWith(suf));
}

function StockLogo({ ticker, size = 32, borderRadius = 8 }) {
  const rawTicker = (ticker || "").trim();
  const baseTicker = rawTicker.split(".")[0] || rawTicker;

  const primarySrc = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(rawTicker)}?format=png`;
  const secondarySrc = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(baseTicker)}?format=png`;
  const fallbackSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(baseTicker)}&background=18181b&color=fafafa&size=64&font-size=0.4&bold=true`;

  return (
    <img
      src={primarySrc}
      alt={rawTicker}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${borderRadius}px`,
        objectFit: "cover",
        display: "block",
        flexShrink: 0,
      }}
      onError={(e) => {
        if (e.currentTarget.src === primarySrc && baseTicker !== rawTicker) {
          e.currentTarget.src = secondarySrc;
        } else {
          e.currentTarget.onerror = null;
          e.currentTarget.src = fallbackSrc;
        }
      }}
    />
  );
}

function SwapArrowIcon({ size = 14, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M4 12h16" />
      <path d="M8 8l-4 4 4 4" />
      <path d="M16 8l4 4-4 4" />
    </svg>
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

function formatCompactCurrency(val, currency = "USD") {
  const num = Number(val || 0);
  const sym = currency === "EUR" ? "€" : "$";
  if (num >= 1_000_000) {
    return currency === "EUR"
      ? `${(num / 1_000_000).toFixed(2)}M €`
      : `$${(num / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000) {
    return currency === "EUR"
      ? `${(num / 1_000).toFixed(1)}K €`
      : `$${(num / 1_000).toFixed(1)}K`;
  }
  return currency === "EUR" ? `${num.toFixed(0)} ${sym}` : `${sym}${num.toFixed(0)}`;
}

function formatMoney(val, currency = "USD") {
  const num = Number(val || 0);
  if (currency === "EUR") {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
    }).format(num);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

function parseAndValidateDate(inputStr) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(inputStr.trim());
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) {
    return null;
  }

  const checkDate = new Date(year, month - 1, day);
  if (
    checkDate.getFullYear() !== year ||
    checkDate.getMonth() !== month - 1 ||
    checkDate.getDate() !== day
  ) {
    return null;
  }

  return `${match[3]}-${match[1]}-${match[2]}`;
}

export default function Dashboard({ user, onLogout }) {
  // Moeda da vista universal persistida em localStorage ("EUR" ou "USD")
  const [viewCurrency, setViewCurrency] = useState(
    () => localStorage.getItem("user_currency") || "EUR"
  );
  // spotFxRate guarda sempre a referência EUR/USD (1 EUR = X USD)
  const [spotFxRate, setSpotFxRate] = useState(1.085);
  // Controla se a cotação cambial é exibida/introduzida como EUR/USD (false) ou USD/EUR (true)
  const [isFxInverted, setIsFxInverted] = useState(false);

  const [dateError, setDateError] = useState("");
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState("");
  const [hoveredTicker, setHoveredTicker] = useState(null);
  const [openPnlTicker, setOpenPnlTicker] = useState(null);
  const [showTotalPnlBreakdown, setShowTotalPnlBreakdown] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [txType, setTxType] = useState("BUY");
  const [txTicker, setTxTicker] = useState("");
  const [txName, setTxName] = useState("");
  const [txShares, setTxShares] = useState("");
  const [txPrice, setTxPrice] = useState("");
  const [txAssetCurrency, setTxAssetCurrency] = useState("USD");
  const [txExchangeRate, setTxExchangeRate] = useState("1.0850");
  const [txDate, setTxDate] = useState("");

  const [allSymbols, setAllSymbols] = useState([]);
  const [remoteResults, setRemoteResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const hiddenDatePickerRef = useRef(null);

  // Guarda a moeda escolhida sempre que o user alterna no topo
  const handleCurrencyChange = (newCurr) => {
    setViewCurrency(newCurr);
    localStorage.setItem("user_currency", newCurr);
  };

  // Alterna entre EUR/USD e USD/EUR e inverte automaticamente o valor do input no modal
  const handleToggleFxDirection = () => {
    setIsFxInverted((prev) => {
      const nextInverted = !prev;
      const currentVal = parseFloat(txExchangeRate);
      if (currentVal && currentVal > 0) {
        setTxExchangeRate((1 / currentVal).toFixed(4));
      } else {
        const baseSpot = spotFxRate > 0 ? spotFxRate : 1.085;
        setTxExchangeRate(
          nextInverted ? (1 / baseSpot).toFixed(4) : baseSpot.toFixed(4)
        );
      }
      return nextInverted;
    });
  };

  // Carrega symbols.json logo no arranque para mapear os nomes tanto na tabela como no modal
  useEffect(() => {
    fetch("/symbols.json")
      .then((res) => res.json())
      .then((data) => setAllSymbols(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Erro ao carregar symbols.json:", err));
  }, []);

  // Pesquisa em tempo real (Just-in-Time) no endpoint /search da API Gateway com debounce de 250ms
  useEffect(() => {
    const q = txTicker.trim();
    if (!q || q.length < 2) {
      setRemoteResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setRemoteResults(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error("Erro na pesquisa remota de símbolos:", err);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [txTicker]);

  // Mapa rápido em memória O(1) de Ticker -> Nome da Empresa
  const symbolsMap = useMemo(() => {
    const map = {};
    for (let i = 0; i < allSymbols.length; i++) {
      const item = allSymbols[i];
      if (item.s && item.n && !map[item.s.toUpperCase()]) {
        map[item.s.toUpperCase()] = item.n;
      }
    }
    for (let i = 0; i < remoteResults.length; i++) {
      const item = remoteResults[i];
      if (item.s && item.n && !map[item.s.toUpperCase()]) {
        map[item.s.toUpperCase()] = item.n;
      }
    }
    return map;
  }, [allSymbols, remoteResults]);

  // Combina recomendações locais (symbols.json) com resultados em tempo real do Yahoo (/search)
  const mergedSuggestions = useMemo(() => {
    const q = txTicker.trim().toUpperCase();
    if (!q || q.length < 1) return [];

    const localMatches = [];

    for (let i = 0; i < allSymbols.length; i++) {
      const item = allSymbols[i];
      const sym = (item.s || "").toUpperCase();
      const name = (item.n || "").toUpperCase();

      let score = 0;
      if (sym === q) {
        score = 100;
      } else if (sym.startsWith(q)) {
        score = 80 - Math.min(sym.length - q.length, 20);
      } else if (name.startsWith(q)) {
        score = 50;
      } else if (sym.includes(q)) {
        score = 30;
      } else if (name.includes(q)) {
        score = 10;
      }

      if (score > 0) {
        localMatches.push({ item, score });
      }
    }

    localMatches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.s.localeCompare(b.item.s);
    });

    const topLocal = localMatches.slice(0, 5).map((m) => m.item);
    const seen = new Set();
    const combined = [];

    // Se houver correspondência exata ou começo direto nos resultados remotos (ex: SXR8.DE), dá prioridade
    for (const rem of remoteResults) {
      const sym = (rem.s || "").toUpperCase();
      if (sym && !seen.has(sym)) {
        combined.push(rem);
        seen.add(sym);
      }
    }

    for (const loc of topLocal) {
      const sym = (loc.s || "").toUpperCase();
      if (sym && !seen.has(sym)) {
        combined.push(loc);
        seen.add(sym);
      }
    }

    return combined.slice(0, 7);
  }, [allSymbols, txTicker, remoteResults]);

  // Atualiza automaticamente o nome e a moeda sugerida sempre que o txTicker muda
  useEffect(() => {
    const clean = txTicker.trim().toUpperCase();
    if (!clean) {
      setTxName("");
      return;
    }

    if (isEuropeanEurTicker(clean)) {
      setTxAssetCurrency("EUR");
    }

    if (symbolsMap[clean]) {
      setTxName(symbolsMap[clean]);
    } else if (mergedSuggestions.length > 0) {
      setTxName(mergedSuggestions[0].n || "");
    } else {
      setTxName("");
    }
  }, [txTicker, symbolsMap, mergedSuggestions]);

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
      if (data.fx_rate_eur_usd && Number(data.fx_rate_eur_usd) > 0) {
        const fetchedRate = Number(data.fx_rate_eur_usd);
        setSpotFxRate(fetchedRate);
      }
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

  // Cálculo da carteira + Decomposição de Retorno (Stock vs FX) para os 4 cenários
  const portfolio = useMemo(() => {
    const isEurView = viewCurrency === "EUR";
    const safeFx = spotFxRate > 0 ? spotFxRate : 1.085;

    let totalValue = 0;
    let totalInvested = 0;
    let dayChangeAmount = 0;
    let totalStockPnl = 0;
    let totalFxPnl = 0;

    const enriched = positions.map((p, idx) => {
      const shares = Number(p.shares || 0);
      const assetCurrency = String(p.asset_currency || "USD").toUpperCase();

      const avgCostUsd = Number(p.avg_cost_usd ?? p.avg_cost ?? 0);
      const avgCostEur = Number(
        p.avg_cost_eur ?? (avgCostUsd / safeFx)
      );

      const currentPriceUsd = Number(
        p.current_price_usd ?? p.current_price ?? avgCostUsd
      );
      const currentPriceEur = Number(
        p.current_price_eur ?? (currentPriceUsd / safeFx)
      );

      // Preço Médio e Preço Atual na moeda nativa do ativo (para a tabela de posições)
      const avgCostNative = assetCurrency === "EUR" ? avgCostEur : avgCostUsd;
      const currentPriceNative =
        assetCurrency === "EUR" ? currentPriceEur : currentPriceUsd;

      // Valores na moeda da vista (para cálculos agregados)
      const avgCostView = isEurView ? avgCostEur : avgCostUsd;
      const currentPriceView = isEurView ? currentPriceEur : currentPriceUsd;
      const dayChangePct = Number(p.day_change_pct || 0);

      const marketValue = isEurView
        ? Number(p.market_value_eur ?? shares * currentPriceEur)
        : Number(p.market_value_usd ?? p.market_value ?? shares * currentPriceUsd);

      const invested = isEurView
        ? Number(p.invested_eur ?? shares * avgCostEur)
        : Number(p.invested_usd ?? shares * avgCostUsd);

      const pnlValue = marketValue - invested;
      const pnlPct = invested > 0 ? (pnlValue / invested) * 100 : 0;
      const posDayChange = marketValue * (dayChangePct / 100);

      // Taxa de câmbio média implícita de entrada (EUR/USD)
      const impliedEntryFx =
        avgCostEur > 0 ? avgCostUsd / avgCostEur : safeFx;

      // Decomposição exata nos 4 cenários (Ativo USD/EUR x Vista USD/EUR)
      let stockPnl = pnlValue;
      let fxPnl = 0;
      const hasFxExposure = assetCurrency !== viewCurrency;

      if (!hasFxExposure) {
        // Cenário 1 & 2: Ativo na mesma moeda da Vista (USD->USD ou EUR->EUR)
        stockPnl = pnlValue;
        fxPnl = 0;
      } else if (assetCurrency === "USD" && viewCurrency === "EUR") {
        // Cenário 3: Ativo cotado em USD visto em EUR
        const rawStockGainUsd = (currentPriceUsd - avgCostUsd) * shares;
        stockPnl = impliedEntryFx > 0 ? rawStockGainUsd / impliedEntryFx : pnlValue;
        fxPnl = pnlValue - stockPnl;
      } else if (assetCurrency === "EUR" && viewCurrency === "USD") {
        // Cenário 4: Ativo cotado em EUR visto em USD
        const rawStockGainEur = (currentPriceEur - avgCostEur) * shares;
        stockPnl = rawStockGainEur * impliedEntryFx;
        fxPnl = pnlValue - stockPnl;
      }

      const stockPnlPct = invested > 0 ? (stockPnl / invested) * 100 : 0;
      const fxPnlPct = invested > 0 ? (fxPnl / invested) * 100 : 0;

      totalValue += marketValue;
      totalInvested += invested;
      dayChangeAmount += posDayChange;
      totalStockPnl += stockPnl;
      totalFxPnl += fxPnl;

      const cleanSym = (p.ticker || "").toUpperCase();
      const rawName = p.name && !p.name.endsWith("Equity") ? p.name : null;

      return {
        ...p,
        ticker: cleanSym,
        name: rawName || symbolsMap[cleanSym] || `${cleanSym} Equity`,
        shares,
        asset_currency: assetCurrency,
        has_fx_exposure: hasFxExposure,
        implied_entry_fx: impliedEntryFx,
        avg_cost: avgCostView,
        avg_cost_native: avgCostNative,
        avg_cost_usd: avgCostUsd,
        avg_cost_eur: avgCostEur,
        current_price: currentPriceView,
        current_price_native: currentPriceNative,
        current_price_usd: currentPriceUsd,
        current_price_eur: currentPriceEur,
        day_change_pct: dayChangePct,
        color: PALETTE[idx % PALETTE.length],
        market_value: marketValue,
        invested,
        pnl_value: pnlValue,
        pnl_pct: pnlPct,
        stock_pnl: stockPnl,
        stock_pnl_pct: stockPnlPct,
        fx_pnl: fxPnl,
        fx_pnl_pct: fxPnlPct,
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
    const totalStockPnlPct =
      totalInvested > 0 ? (totalStockPnl / totalInvested) * 100 : 0;
    const totalFxPnlPct =
      totalInvested > 0 ? (totalFxPnl / totalInvested) * 100 : 0;
    const dayChangePct = totalValue > 0 ? (dayChangeAmount / totalValue) * 100 : 0;

    return {
      totalValue,
      totalInvested,
      totalPnlValue,
      totalPnlPct,
      totalStockPnl,
      totalStockPnlPct,
      totalFxPnl,
      totalFxPnlPct,
      dayChangeDollar: dayChangeAmount,
      dayChangePct,
      items: withAllocation,
    };
  }, [positions, symbolsMap, viewCurrency, spotFxRate]);

  const activeCenterItem = useMemo(() => {
    if (!portfolio.items.length) return null;
    if (hoveredTicker) {
      return portfolio.items.find((i) => i.ticker === hoveredTicker) || portfolio.items[0];
    }
    return portfolio.items[0];
  }, [portfolio, hoveredTicker]);

  // Normaliza a taxa introduzida no modal para EUR/USD (1 EUR = X USD)
  const normalizedEurUsdRate = useMemo(() => {
    if (txAssetCurrency === viewCurrency) return 1.0;
    const raw = parseFloat(txExchangeRate);
    if (!raw || isNaN(raw) || raw <= 0) return null;
    return isFxInverted ? 1 / raw : raw;
  }, [txAssetCurrency, viewCurrency, txExchangeRate, isFxInverted]);

  // Pré-visualização de conversão em tempo real no Modal
  const modalPreview = useMemo(() => {
    const s = parseFloat(txShares);
    const p = parseFloat(txPrice);
    const fxEurUsd = normalizedEurUsdRate;

    if (!s || s <= 0 || isNaN(p) || p < 0 || !fxEurUsd || fxEurUsd <= 0) {
      return null;
    }

    const totalNative = s * p;
    let totalUsd = totalNative;
    let totalEur = totalNative;

    if (txAssetCurrency === "USD") {
      totalUsd = totalNative;
      totalEur =
        txAssetCurrency === viewCurrency ? totalNative : totalNative / fxEurUsd;
    } else {
      totalEur = totalNative;
      totalUsd =
        txAssetCurrency === viewCurrency ? totalNative : totalNative * fxEurUsd;
    }

    return {
      totalNative,
      totalUsd,
      totalEur,
      needsConversion: txAssetCurrency !== viewCurrency,
    };
  }, [txShares, txPrice, txAssetCurrency, viewCurrency, normalizedEurUsdRate]);

  function openNewOperationModal() {
    setApiError("");
    setDateError("");
    const baseRate = spotFxRate > 0 ? spotFxRate : 1.085;
    setTxExchangeRate(
      isFxInverted ? (1 / baseRate).toFixed(4) : baseRate.toFixed(4)
    );
    setIsModalOpen(true);
  }

  function handleDateTextChange(e) {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, "").slice(0, 8);

    let formatted = digits;
    if (digits.length > 4) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    } else if (digits.length > 2) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }

    setTxDate(formatted);

    if (formatted.length === 10) {
      const iso = parseAndValidateDate(formatted);
      if (!iso) {
        setDateError("Data inválida. Insere no formato mm/dd/yyyy (ex: 10/25/2026).");
      } else {
        setDateError("");
      }
    } else {
      setDateError("");
    }
  }

  function handleNativeCalendarPick(e) {
    const isoVal = e.target.value;
    if (!isoVal) return;
    const [yyyy, mm, dd] = isoVal.split("-");
    if (yyyy && mm && dd) {
      setTxDate(`${mm}/${dd}/${yyyy}`);
      setDateError("");
    }
  }

  async function handleTransactionSubmit(e) {
    e.preventDefault();
    setApiError("");

    const isoDate = parseAndValidateDate(txDate);
    if (!isoDate) {
      setDateError("Formato incorreto. Insere Mês/Dia/Ano (mm/dd/yyyy).");
      return;
    }

    const isSameCurrency = txAssetCurrency === viewCurrency;
    const finalEurUsdFx = isSameCurrency ? 1.0 : normalizedEurUsdRate;

    if (!finalEurUsdFx || isNaN(finalEurUsdFx) || finalEurUsdFx <= 0) {
      setApiError("Insere uma taxa de câmbio válida maior que 0.");
      return;
    }

    setSubmitting(true);

    const cleanSymbol = txTicker.trim().toUpperCase();
    const numShares = parseFloat(txShares);
    const numPrice = parseFloat(txPrice);

    try {
      const resolvedName = txName.trim() || symbolsMap[cleanSymbol] || "";
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
          asset_currency: txAssetCurrency,
          base_currency: viewCurrency,
          exchange_rate: Number(finalEurUsdFx.toFixed(6)),
          date: isoDate,
          name: resolvedName,
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
      setTxDate("");
      setDateError("");
      setIsModalOpen(false);
    } catch (err) {
      setApiError(err.message || "Falha ao comunicar com o servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  const maxPositionValue =
    portfolio.items.length > 0 ? portfolio.items[0].market_value : 1;

  const currencySymbol = viewCurrency === "EUR" ? "€" : "$";
  const needsFxConversion = txAssetCurrency !== viewCurrency;
  const displayedSpotRate = isFxInverted
    ? (1 / (spotFxRate || 1.085)).toFixed(4)
    : (spotFxRate || 1.085).toFixed(4);
  const fxPairLabel = isFxInverted ? "USD/EUR" : "EUR/USD";

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

          {/* Botão/Badge da Taxa BCE com Dupla Seta para inverter EUR/USD <-> USD/EUR */}
          <button
            type="button"
            onClick={handleToggleFxDirection}
            style={styles.fxRateBadgeBtn}
            title="Clica para inverter o par cambial (EUR/USD ↔ USD/EUR)"
          >
            <span>
              BCE {fxPairLabel}: {displayedSpotRate}
            </span>
            <SwapArrowIcon size={13} color="#10b981" />
          </button>
        </div>

        <div style={styles.navActions}>
          {/* Toggle Universal de Moeda (EUR / USD) */}
          <div style={styles.currencyToggleGroup}>
            <button
              type="button"
              onClick={() => handleCurrencyChange("EUR")}
              style={{
                ...styles.currencyToggleBtn,
                ...(viewCurrency === "EUR" ? styles.currencyToggleBtnActive : {}),
              }}
            >
              EUR €
            </button>
            <button
              type="button"
              onClick={() => handleCurrencyChange("USD")}
              style={{
                ...styles.currencyToggleBtn,
                ...(viewCurrency === "USD" ? styles.currencyToggleBtnActive : {}),
              }}
            >
              USD $
            </button>
          </div>

          <button
            type="button"
            onClick={openNewOperationModal}
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
            <span style={styles.kpiLabel}>
              VALOR TOTAL DA CARTEIRA ({viewCurrency})
            </span>
            <div style={styles.kpiCenterRow}>
              <span style={styles.kpiBigValue}>
                {formatMoney(portfolio.totalValue, viewCurrency)}
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
            <span style={styles.kpiLabel}>
              CAPITAL TOTAL INVESTIDO ({viewCurrency})
            </span>
            <div style={styles.kpiCenterRow}>
              <span style={styles.kpiBigValue}>
                {formatMoney(portfolio.totalInvested, viewCurrency)}
              </span>
            </div>
            <span style={styles.kpiSub}>
              {viewCurrency === "EUR"
                ? "Custo real acumulado (câmbio)"
                : "Custo médio ponderado acumulado"}
            </span>
          </div>

          {/* Card de Rentabilidade Total com Popover de Decomposição (Stock vs FX) */}
          <div
            style={{ ...styles.kpiCard, position: "relative", cursor: "pointer" }}
            onMouseEnter={() => setShowTotalPnlBreakdown(true)}
            onMouseLeave={() => setShowTotalPnlBreakdown(false)}
            onClick={() => setShowTotalPnlBreakdown((prev) => !prev)}
          >
            <span style={styles.kpiLabel}>
              RENTABILIDADE TOTAL (P&L {currencySymbol}) ▾
            </span>
            <div style={styles.kpiCenterRow}>
              <span
                style={{
                  ...styles.kpiBigValue,
                  color: portfolio.totalPnlValue >= 0 ? "#10b981" : "#ef4444",
                }}
              >
                {portfolio.totalPnlValue >= 0 ? "+" : ""}
                {formatMoney(portfolio.totalPnlValue, viewCurrency)}
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
              Ação:{" "}
              {portfolio.totalStockPnl >= 0 ? "+" : ""}
              {formatMoney(portfolio.totalStockPnl, viewCurrency)} · FX:{" "}
              {portfolio.totalFxPnl >= 0 ? "+" : ""}
              {formatMoney(portfolio.totalFxPnl, viewCurrency)}
            </span>

            {showTotalPnlBreakdown && portfolio.items.length > 0 && (
              <div style={{ ...styles.fxPopover, top: "96%", left: "1.2rem", right: "auto" }}>
                <div style={styles.fxPopoverHeader}>
                  Decomposição Global ({viewCurrency})
                </div>
                <div style={styles.fxPopoverRow}>
                  <span style={styles.fxPopoverDim}>Valorização Ações:</span>
                  <span
                    style={{
                      ...styles.fxPopoverVal,
                      color: portfolio.totalStockPnl >= 0 ? "#10b981" : "#ef4444",
                    }}
                  >
                    {portfolio.totalStockPnl >= 0 ? "+" : ""}
                    {formatMoney(portfolio.totalStockPnl, viewCurrency)} (
                    {portfolio.totalStockPnlPct >= 0 ? "+" : ""}
                    {portfolio.totalStockPnlPct.toFixed(2)}%)
                  </span>
                </div>
                <div style={styles.fxPopoverRow}>
                  <span style={styles.fxPopoverDim}>Impacto Cambial (FX):</span>
                  <span
                    style={{
                      ...styles.fxPopoverVal,
                      color:
                        Math.abs(portfolio.totalFxPnl) < 0.005
                          ? "#94a3b8"
                          : portfolio.totalFxPnl >= 0
                          ? "#10b981"
                          : "#ef4444",
                    }}
                  >
                    {portfolio.totalFxPnl >= 0 ? "+" : ""}
                    {formatMoney(portfolio.totalFxPnl, viewCurrency)} (
                    {portfolio.totalFxPnlPct >= 0 ? "+" : ""}
                    {portfolio.totalFxPnlPct.toFixed(2)}%)
                  </span>
                </div>
              </div>
            )}
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
                  {formatMoney(portfolio.items[0].market_value, viewCurrency)}
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
              onClick={openNewOperationModal}
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
                      const baseTicker = (slice.ticker || "").split(".")[0];
                      const logoUrl = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(baseTicker)}?format=png`;

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
                            <g transform={`translate(${badgePos.x}, ${badgePos.y})`}>
                              {/* foreignObject permite colocar o componente StockLogo com todo o tratamento de erro dentro do SVG */}
                              <foreignObject
                                x="-17"
                                y="-17"
                                width="34"
                                height="34"
                                style={{ overflow: "visible" }}
                              >
                                <StockLogo
                                  ticker={slice.ticker}
                                  size={34}
                                  borderRadius={8}
                                />
                              </foreignObject>

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
                          {formatMoney(activeCenterItem.market_value, viewCurrency)}
                        </text>
                      </g>
                    )}
                  </svg>
                </div>
              </div>

              <div style={styles.panelCard}>
                <div style={styles.panelHeader}>
                  <h2 style={styles.panelTitle}>
                    Carteira por Valor de Mercado ({viewCurrency})
                  </h2>
                </div>

                <div style={styles.barsList}>
                  {portfolio.items.map((item) => {
                    const widthPct = Math.max(
                      (item.market_value / maxPositionValue) * 100,
                      4
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
                          />
                          <span style={styles.barValueLabel}>
                            {formatCompactCurrency(item.market_value, viewCurrency)}
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
                  Posições Ativas & Rentabilidade ({viewCurrency})
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
                      <th style={styles.thRight}>
                        VALOR MERCADO ({currencySymbol})
                      </th>
                      <th style={styles.thRight}>
                        LUCRO / P&L ({currencySymbol})
                      </th>
                      <th style={styles.thRight}>ALOCAÇÃO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.items.map((item) => {
                      const isProfit = item.pnl_value >= 0;
                      const isDayUp = item.day_change_pct >= 0;
                      const isPopoverOpen = openPnlTicker === item.ticker;

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
                              <div style={styles.tdTicker}>
                                {item.ticker}
                                <span style={styles.assetCurrTag}>
                                  {item.asset_currency}
                                </span>
                              </div>
                              <div style={styles.tdName}>{item.name}</div>
                            </div>
                          </td>

                          <td style={styles.tdRight}>{item.shares}</td>

                          {/* Preço Médio e Preço Atual sempre na moeda nativa do Ativo */}
                          <td style={styles.tdRight}>
                            {formatMoney(item.avg_cost_native, item.asset_currency)}
                          </td>
                          <td
                            style={{
                              ...styles.tdRight,
                              fontWeight: 600,
                              color: "#fff",
                            }}
                          >
                            {formatMoney(
                              item.current_price_native,
                              item.asset_currency
                            )}
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
                            {formatMoney(item.market_value, viewCurrency)}
                          </td>

                          {/* Célula de P&L com Dropdown/Popover de Decomposição (Stock vs FX) */}
                          <td
                            style={{
                              ...styles.tdRight,
                              position: "relative",
                              cursor: "pointer",
                            }}
                            onMouseEnter={() => setOpenPnlTicker(item.ticker)}
                            onMouseLeave={() => setOpenPnlTicker(null)}
                            onClick={() =>
                              setOpenPnlTicker((prev) =>
                                prev === item.ticker ? null : item.ticker
                              )
                            }
                          >
                            <div
                              style={{
                                color: isProfit ? "#10b981" : "#ef4444",
                                fontWeight: 600,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.3rem",
                              }}
                            >
                              <span>
                                {isProfit ? "+" : ""}
                                {formatMoney(item.pnl_value, viewCurrency)}
                              </span>
                              <span style={styles.fxTriggerBadge}>▾</span>
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

                            {isPopoverOpen && (
                              <div style={styles.fxPopover}>
                                <div style={styles.fxPopoverHeader}>
                                  Decomposição P&L ({item.ticker})
                                </div>

                                <div style={styles.fxPopoverRow}>
                                  <span style={styles.fxPopoverDim}>
                                    Ação ({item.asset_currency}):
                                  </span>
                                  <span
                                    style={{
                                      ...styles.fxPopoverVal,
                                      color:
                                        item.stock_pnl >= 0 ? "#10b981" : "#ef4444",
                                    }}
                                  >
                                    {item.stock_pnl >= 0 ? "+" : ""}
                                    {formatMoney(item.stock_pnl, viewCurrency)} (
                                    {item.stock_pnl_pct >= 0 ? "+" : ""}
                                    {item.stock_pnl_pct.toFixed(2)}%)
                                  </span>
                                </div>

                                <div style={styles.fxPopoverRow}>
                                  <span style={styles.fxPopoverDim}>
                                    Câmbio (FX):
                                  </span>
                                  <span
                                    style={{
                                      ...styles.fxPopoverVal,
                                      color: !item.has_fx_exposure
                                        ? "#94a3b8"
                                        : item.fx_pnl >= 0
                                        ? "#10b981"
                                        : "#ef4444",
                                    }}
                                  >
                                    {item.fx_pnl >= 0 ? "+" : ""}
                                    {formatMoney(item.fx_pnl, viewCurrency)} (
                                    {item.fx_pnl_pct >= 0 ? "+" : ""}
                                    {item.fx_pnl_pct.toFixed(2)}%)
                                  </span>
                                </div>

                                <div style={styles.fxPopoverFooter}>
                                  {item.has_fx_exposure ? (
                                    <span>
                                      FX Compra ({fxPairLabel}):{" "}
                                      {(isFxInverted
                                        ? 1 / item.implied_entry_fx
                                        : item.implied_entry_fx
                                      ).toFixed(4)}{" "}
                                      · Atual: {displayedSpotRate}
                                    </span>
                                  ) : (
                                    <span>
                                      Sem exposição cambial ({item.asset_currency} ={" "}
                                      {viewCurrency})
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
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
                <div style={{ ...styles.field, position: "relative" }}>
                  <label style={styles.label}>TICKER</label>
                  <input
                    type="text"
                    required
                    placeholder="NVDA ou SXR8.DE"
                    autoComplete="off"
                    value={txTicker}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                    onChange={(e) => {
                      setTxTicker(e.target.value.toUpperCase());
                      setShowDropdown(true);
                    }}
                    style={styles.input}
                  />

                  {showDropdown && mergedSuggestions.length > 0 && (
                    <div style={styles.dropdownMenu}>
                      {mergedSuggestions.map((item) => {
                        const suggestedCurr =
                          item.c || (isEuropeanEurTicker(item.s) ? "EUR" : "USD");

                        return (
                          <div
                            key={item.s}
                            style={styles.dropdownItem}
                            onMouseDown={() => {
                              setTxTicker(item.s);
                              setTxName(item.n || "");
                              setTxAssetCurrency(suggestedCurr);
                              setShowDropdown(false);
                            }}
                          >
                            <StockLogo ticker={item.s} size={22} borderRadius={6} />
                            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                <span style={styles.dropdownTicker}>{item.s}</span>
                                <span style={styles.assetCurrTag}>{suggestedCurr}</span>
                              </div>
                              <span style={styles.dropdownName}>{item.n}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>NOME DA EMPRESA</label>
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    placeholder="Preenchimento automático"
                    value={txName}
                    style={{
                      ...styles.input,
                      ...styles.readOnlyInput,
                    }}
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
                  <label style={styles.label}>
                    PREÇO UNITÁRIO ({txAssetCurrency === "EUR" ? "€" : "$"})
                  </label>
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

              {/* Linha de Moeda do Ativo + Taxa de Câmbio Manual com Dupla Seta */}
              <div style={styles.formRow}>
                <div style={styles.field}>
                  <label style={styles.label}>MOEDA DO ATIVO</label>
                  <select
                    value={txAssetCurrency}
                    onChange={(e) => setTxAssetCurrency(e.target.value)}
                    style={styles.input}
                  >
                    <option value="USD">USD ($) — Bolsa EUA</option>
                    <option value="EUR">EUR (€) — Bolsa Europa</option>
                  </select>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>
                    <span style={styles.fxLabelGroup}>
                      <span>TAXA FX ({fxPairLabel})</span>
                      {needsFxConversion && (
                        <button
                          type="button"
                          onClick={handleToggleFxDirection}
                          style={styles.fxSwapInlineBtn}
                          title="Trocar entre EUR/USD e USD/EUR"
                        >
                          <SwapArrowIcon size={13} color="#10b981" />
                        </button>
                      )}
                    </span>
                    <span style={styles.labelHint}>
                      {needsFxConversion ? "Manual" : "1:1"}
                    </span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    disabled={!needsFxConversion}
                    placeholder={isFxInverted ? "0.8916" : "1.1216"}
                    value={needsFxConversion ? txExchangeRate : "1.0000"}
                    onChange={(e) => setTxExchangeRate(e.target.value)}
                    style={{
                      ...styles.input,
                      ...(!needsFxConversion ? styles.readOnlyInput : {}),
                    }}
                  />
                </div>
              </div>

              {/* Resumo de Conversão Cambial em Tempo Real */}
              {modalPreview && (
                <div style={styles.fxPreviewBox}>
                  <div style={styles.fxPreviewRow}>
                    <span style={styles.fxPreviewLabel}>Valor na Bolsa (USD):</span>
                    <span style={styles.fxPreviewVal}>
                      {formatMoney(modalPreview.totalUsd, "USD")}
                    </span>
                  </div>
                  <div style={styles.fxPreviewRow}>
                    <span style={styles.fxPreviewLabel}>
                      Valor Equivalente (EUR):
                    </span>
                    <span style={{ ...styles.fxPreviewVal, color: "#10b981" }}>
                      {formatMoney(modalPreview.totalEur, "EUR")}
                    </span>
                  </div>
                </div>
              )}

              <div style={styles.field}>
                <label style={styles.label}>
                  DATA DA OPERAÇÃO <span style={styles.labelHint}>(mm/dd/yyyy)</span>
                </label>

                <div style={styles.dateInputWrapper}>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    placeholder="mm/dd/yyyy"
                    maxLength={10}
                    value={txDate}
                    onChange={handleDateTextChange}
                    style={{
                      ...styles.input,
                      ...styles.dateInputCustom,
                      borderColor: dateError ? "#ef4444" : "#23382f",
                    }}
                  />

                  <input
                    ref={hiddenDatePickerRef}
                    type="date"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={handleNativeCalendarPick}
                    style={styles.hiddenDateInput}
                  />

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      const picker = hiddenDatePickerRef.current;
                      if (picker) {
                        if (typeof picker.showPicker === "function") {
                          picker.showPicker();
                        } else {
                          picker.focus();
                          picker.click();
                        }
                      }
                    }}
                    style={styles.calendarTriggerBtn}
                    title="Abrir calendário"
                  >
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#64748b"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </button>
                </div>

                {dateError ? (
                  <span style={styles.errorTextTip}>{dateError}</span>
                ) : (
                  <span style={styles.lightHintText}>
                    Atenção: insere os números (Mês/Dia/Ano) ou usa o calendário à direita.
                  </span>
                )}
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
  fxRateBadgeBtn: {
    marginLeft: "0.5rem",
    padding: "0.25rem 0.6rem",
    borderRadius: "6px",
    backgroundColor: "#111e19",
    border: "1px solid #1f352c",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "#cbd5e1",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    cursor: "pointer",
    transition: "border-color 0.15s ease, background-color 0.15s ease",
  },
  navActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  currencyToggleGroup: {
    display: "flex",
    alignItems: "center",
    backgroundColor: "#0d1713",
    border: "1px solid #23382f",
    borderRadius: "8px",
    padding: "0.18rem",
    gap: "0.2rem",
  },
  currencyToggleBtn: {
    padding: "0.38rem 0.72rem",
    borderRadius: "6px",
    border: "none",
    backgroundColor: "transparent",
    color: "#8e959e",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.78rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  currencyToggleBtnActive: {
    backgroundColor: "#059669",
    color: "#ffffff",
    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.35)",
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
  tableSubHint: {
    fontSize: "0.76rem",
    color: "#8e959e",
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
    transition: "width 0.25s ease, background-color 0.15s ease",
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
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  assetCurrTag: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.64rem",
    fontWeight: 600,
    padding: "0.1rem 0.35rem",
    borderRadius: "4px",
    backgroundColor: "#14221d",
    border: "1px solid #23382f",
    color: "#94a3b8",
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
  fxTriggerBadge: {
    fontSize: "0.72rem",
    color: "#64748b",
    padding: "0.05rem 0.25rem",
    borderRadius: "4px",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  fxPopover: {
    position: "absolute",
    right: "0.75rem",
    top: "88%",
    zIndex: 60,
    backgroundColor: "#0b1411",
    border: "1px solid #263e34",
    borderRadius: "10px",
    padding: "0.75rem 0.9rem",
    minWidth: "255px",
    boxShadow: "0 12px 28px rgba(0, 0, 0, 0.8)",
    display: "flex",
    flexDirection: "column",
    gap: "0.42rem",
    textAlign: "left",
    pointerEvents: "none",
  },
  fxPopoverHeader: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.68rem",
    fontWeight: 700,
    color: "#94a3b8",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    borderBottom: "1px solid #1a2c24",
    paddingBottom: "0.35rem",
    marginBottom: "0.1rem",
  },
  fxPopoverRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.75rem",
  },
  fxPopoverDim: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.75rem",
    color: "#a1a1aa",
  },
  fxPopoverVal: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.76rem",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  fxPopoverFooter: {
    marginTop: "0.2rem",
    paddingTop: "0.35rem",
    borderTop: "1px dashed #1a2c24",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.68rem",
    color: "#64748b",
    textAlign: "right",
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
    maxWidth: "480px",
    boxSizing: "border-box",
    backgroundColor: "#0e1714",
    border: "1px solid #23382f",
    borderRadius: "16px",
    padding: "1.85rem 2rem",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1.1rem",
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
    marginBottom: "1.15rem",
  },
  switchBtn: {
    padding: "0.6rem",
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
    gap: "0.9rem",
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
    gap: "0.35rem",
    minWidth: 0,
  },
  label: {
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "#d4d4d8",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fxLabelGroup: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
  },
  fxSwapInlineBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.12rem 0.32rem",
    borderRadius: "5px",
    backgroundColor: "#13221c",
    border: "1px solid #233d32",
    cursor: "pointer",
    transition: "background-color 0.15s ease",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    height: "41px",
    padding: "0 0.85rem",
    borderRadius: "7px",
    border: "1px solid #23382f",
    backgroundColor: "#080e0c",
    color: "#ffffff",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.9rem",
    outline: "none",
  },
  readOnlyInput: {
    backgroundColor: "#0b120f",
    borderColor: "#1a2923",
    color: "#94a3b8",
    cursor: "not-allowed",
    userSelect: "none",
  },
  fxPreviewBox: {
    padding: "0.65rem 0.85rem",
    borderRadius: "8px",
    backgroundColor: "#09110e",
    border: "1px solid #1c2e26",
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  fxPreviewRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: "0.8rem",
  },
  fxPreviewLabel: {
    color: "#8e959e",
  },
  fxPreviewVal: {
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600,
    color: "#f4f4f5",
  },
  submitModalBtn: {
    marginTop: "0.35rem",
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
  labelHint: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.66rem",
    color: "#10b981",
    fontWeight: 500,
  },
  dateInputWrapper: {
    position: "relative",
    width: "100%",
    display: "flex",
    alignItems: "center",
  },
  dateInputCustom: {
    paddingRight: "2.5rem",
  },
  hiddenDateInput: {
    position: "absolute",
    right: "0.75rem",
    width: "0px",
    height: "0px",
    opacity: 0,
    border: "none",
    padding: 0,
    pointerEvents: "none",
    colorScheme: "dark",
  },
  calendarTriggerBtn: {
    position: "absolute",
    right: "0.75rem",
    background: "none",
    border: "none",
    padding: "0.2rem",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  lightHintText: {
    fontSize: "0.71rem",
    color: "#52605b",
    lineHeight: 1.35,
    marginTop: "0.1rem",
  },
  errorTextTip: {
    fontSize: "0.72rem",
    color: "#ef4444",
    fontWeight: 500,
    marginTop: "0.1rem",
  },
  dropdownMenu: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: "#0d1613",
    border: "1px solid #23382f",
    borderRadius: "8px",
    marginTop: "4px",
    maxHeight: "220px",
    overflowY: "auto",
    boxShadow: "0 12px 30px rgba(0, 0, 0, 0.75)",
  },
  dropdownItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
    padding: "0.55rem 0.75rem",
    cursor: "pointer",
    borderBottom: "1px solid #14221d",
  },
  dropdownTicker: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.85rem",
    fontWeight: 700,
    color: "#ffffff",
  },
  dropdownName: {
    fontSize: "0.72rem",
    color: "#8e959e",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "260px",
  },
};