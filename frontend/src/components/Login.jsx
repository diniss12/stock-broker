import { useState, useEffect } from "react";
import { signIn, signUp, confirmSignUp } from "aws-amplify/auth";

const FALLBACK_TICKERS = [
  { ticker: "NVDA", price: 142.85, change_pct: 2.45 },
  { ticker: "AMZN", price: 210.40, change_pct: 1.18 },
  { ticker: "AAPL", price: 234.10, change_pct: -0.64 },
  { ticker: "GOOGL", price: 184.60, change_pct: 0.92 },
  { ticker: "MSFT", price: 428.50, change_pct: -0.38 },
  { ticker: "TSLA", price: 258.90, change_pct: -1.85 },
  { ticker: "META", price: 592.30, change_pct: 1.74 },
  { ticker: "BRK.B", price: 454.15, change_pct: 0.42 },
  { ticker: "TSM", price: 196.80, change_pct: 3.10 },
  { ticker: "AVGO", price: 178.25, change_pct: -0.55 },
  { ticker: "JPM", price: 229.70, change_pct: 0.88 },
  { ticker: "V", price: 291.40, change_pct: 0.31 },
];

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  "https://7yu2kb0zrj.execute-api.eu-west-1.amazonaws.com";

function StockLogo({ ticker }) {
  const cleanTicker = encodeURIComponent(ticker);
  const primarySrc = `https://assets.parqet.com/logos/symbol/${cleanTicker}?format=png`;
  const fallbackSrc = `https://ui-avatars.com/api/?name=${cleanTicker}&background=27272a&color=fafafa&size=64&font-size=0.4&bold=true`;

  return (
    <img
      src={primarySrc}
      alt={ticker}
      style={styles.tickerLogo}
      onError={(e) => {
        e.currentTarget.onerror = null;
        e.currentTarget.src = fallbackSrc;
      }}
    />
  );
}

export default function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState("LOGIN"); // LOGIN | SIGNUP | CONFIRM
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [marketTickers, setMarketTickers] = useState(FALLBACK_TICKERS);

  useEffect(() => {
    let active = true;

    async function loadMarketFromDb() {
      try {
        const res = await fetch(`${API_BASE_URL}/market`);
        if (!res.ok) return;
        const data = await res.json();

        if (active && Array.isArray(data.tickers) && data.tickers.length > 0) {
          // Mescla os dados vindos da DynamoDB com a lista base para garantir a barra sempre cheia
          const dbMap = {};
          for (const item of data.tickers) {
            const symbol = item.ticker || (item.SK ? item.SK.replace("TICKER#", "") : null);
            if (symbol) {
              dbMap[symbol] = {
                ticker: symbol,
                price: Number(item.price || 0),
                change_pct: Number(item.change_pct ?? 0),
              };
            }
          }

          const merged = FALLBACK_TICKERS.map((defaultItem) =>
            dbMap[defaultItem.ticker] ? dbMap[defaultItem.ticker] : defaultItem
          );

          // Adiciona outros tickers extra que os utilizadores tenham adicionado à base de dados
          for (const symbol of Object.keys(dbMap)) {
            if (!merged.some((m) => m.ticker === symbol)) {
              merged.push(dbMap[symbol]);
            }
          }

          setMarketTickers(merged);
        }
      } catch (err) {
        console.error("Erro ao carregar cache de mercado:", err);
      }
    }

    loadMarketFromDb();
    const interval = setInterval(loadMarketFromDb, 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Duplicamos o array para que o loop contínuo de -50% a 0% seja infinito
  const scrollingTickers = [...marketTickers, ...marketTickers];

  function switchMode(newMode) {
    setError("");
    setUsername("");
    setEmail("");
    setPassword("");
    setCode("");
    setMode(newMode);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    try {
      if (mode === "LOGIN") {
        const { isSignedIn } = await signIn({
          username: cleanUsername,
          password,
        });
        if (isSignedIn) onLoginSuccess();
      } else if (mode === "SIGNUP") {
        await signUp({
          username: cleanUsername,
          password,
          options: {
            userAttributes: {
              email: cleanEmail,
            },
          },
        });
        setMode("CONFIRM");
      } else if (mode === "CONFIRM") {
        await confirmSignUp({
          username: cleanUsername,
          confirmationCode: code.trim(),
        });
        await signIn({ username: cleanUsername, password });
        onLoginSuccess();
      }
    } catch (err) {
      setError(err.message || "Não foi possível autenticar. Verifica os dados.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.viewport}>
      {/* Barra de Cotações Dinâmica ligada à DynamoDB */}
      <header style={styles.tickerBar}>
        <div className="ticker-track">
          {scrollingTickers.map((t, index) => {
            const pct = Number(t.change_pct || 0);
            const isUp = pct >= 0;
            const formattedPrice = Number(t.price || 0).toFixed(2);
            const formattedPct = `${isUp ? "+" : ""}${pct.toFixed(2)}%`;

            return (
              <div key={`${t.ticker}-${index}`} style={styles.tickerItem}>
                <StockLogo ticker={t.ticker} />
                <span style={styles.tickerSymbol}>{t.ticker}</span>
                <span style={styles.tickerPrice}>${formattedPrice}</span>
                <span
                  style={{
                    ...styles.tickerChange,
                    color: isUp ? "#10b981" : "#ef4444",
                    backgroundColor: isUp
                      ? "rgba(16, 185, 129, 0.14)"
                      : "rgba(239, 68, 68, 0.14)",
                  }}
                >
                  {isUp ? "▲" : "▼"} {formattedPct}
                </span>
              </div>
            );
          })}
        </div>
      </header>

      {/* Fundo com Gráficos e Candlesticks */}
      <svg
        viewBox="0 0 1440 900"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={styles.bgSvg}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="greenChartArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.24" />
            <stop offset="65%" stopColor="#064e3b" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#040605" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="greenStrokeLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#065f46" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#10b981" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#059669" stopOpacity="0.45" />
          </linearGradient>
          <filter id="greenGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g stroke="rgba(255,255,255,0.03)" strokeWidth="1">
          <line x1="0" y1="180" x2="1440" y2="180" />
          <line x1="0" y1="360" x2="1440" y2="360" />
          <line x1="0" y1="540" x2="1440" y2="540" />
          <line x1="0" y1="720" x2="1440" y2="720" />
          <line x1="288" y1="0" x2="288" y2="900" />
          <line x1="576" y1="0" x2="576" y2="900" />
          <line x1="864" y1="0" x2="864" y2="900" />
          <line x1="1152" y1="0" x2="1152" y2="900" />
        </g>

        <g opacity="0.28">
          <line x1="140" y1="520" x2="140" y2="670" stroke="#10b981" strokeWidth="3" />
          <rect x="128" y="550" width="24" height="80" rx="3" fill="#10b981" />

          <line x1="205" y1="460" x2="205" y2="610" stroke="#1f2937" strokeWidth="3" />
          <rect x="193" y="485" width="24" height="90" rx="3" fill="#18181b" stroke="#27272a" />

          <line x1="270" y1="490" x2="270" y2="640" stroke="#059669" strokeWidth="3" />
          <rect x="258" y="520" width="24" height="75" rx="3" fill="#059669" />

          <line x1="335" y1="390" x2="335" y2="550" stroke="#ef4444" strokeWidth="3" />
          <rect x="323" y="420" width="24" height="95" rx="3" fill="#ef4444" opacity="0.65" />

          <line x1="400" y1="430" x2="400" y2="580" stroke="#10b981" strokeWidth="3" />
          <rect x="388" y="455" width="24" height="70" rx="3" fill="#10b981" />

          <line x1="980" y1="320" x2="980" y2="480" stroke="#1f2937" strokeWidth="3" />
          <rect x="968" y="350" width="24" height="85" rx="3" fill="#18181b" stroke="#27272a" />

          <line x1="1045" y1="260" x2="1045" y2="420" stroke="#10b981" strokeWidth="3" />
          <rect x="1033" y="290" width="24" height="90" rx="3" fill="#10b981" />

          <line x1="1110" y1="290" x2="1110" y2="440" stroke="#ef4444" strokeWidth="3" />
          <rect x="1098" y="320" width="24" height="65" rx="3" fill="#ef4444" opacity="0.65" />

          <line x1="1175" y1="190" x2="1175" y2="360" stroke="#059669" strokeWidth="3" />
          <rect x="1163" y="220" width="24" height="95" rx="3" fill="#059669" />

          <line x1="1240" y1="150" x2="1240" y2="310" stroke="#10b981" strokeWidth="3" />
          <rect x="1228" y="180" width="24" height="85" rx="3" fill="#10b981" />
        </g>

        <path
          d="M-50 740 C 180 710, 290 540, 470 560 C 650 580, 740 390, 920 410 C 1100 430, 1200 220, 1490 170 L 1490 950 L -50 950 Z"
          fill="url(#greenChartArea)"
        />
        <path
          d="M-50 740 C 180 710, 290 540, 470 560 C 650 580, 740 390, 920 410 C 1100 430, 1200 220, 1490 170"
          stroke="url(#greenStrokeLine)"
          strokeWidth="4"
          strokeLinecap="round"
          filter="url(#greenGlow)"
        />
        <path
          d="M-50 800 C 240 760, 430 650, 660 600 C 910 540, 1100 400, 1490 300"
          stroke="rgba(16, 185, 129, 0.22)"
          strokeWidth="2"
          strokeDasharray="8 8"
        />
      </svg>

      {/* Área Central */}
      <main style={styles.mainStage}>
        <div style={styles.outerGlassFrame}>
          <div style={styles.leftPresentation}>
            <div style={styles.brandRowLeft}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
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
              <span style={styles.logoText}>StockBroker</span>
            </div>

            <h1 style={styles.heroTitle}>
              Acompanha a tua carteira de ações num único lugar.
            </h1>

            <p style={styles.heroDescription}>
              Uma plataforma limpa e direta para investidores que querem registar
              as suas operações de compra e venda, acompanhar o preço médio real
              de cada posição e analisar a rentabilidade da carteira.
            </p>

            <div style={styles.featureList}>
              <div style={styles.featureItem}>
                <span style={styles.featureDot} />
                <div>
                  <h4 style={styles.featureTitle}>Cálculo Automático de Preço Médio</h4>
                  <p style={styles.featureSub}>
                    Atualização imediata do custo médio ponderado e da alocação a cada compra ou venda.
                  </p>
                </div>
              </div>

              <div style={styles.featureItem}>
                <span style={styles.featureDot} />
                <div>
                  <h4 style={styles.featureTitle}>Registo Histórico por Data</h4>
                  <p style={styles.featureSub}>
                    Insere transações com a data exata da operação para manteres o histórico fiel da tua carteira.
                  </p>
                </div>
              </div>

              <div style={styles.featureItem}>
                <span style={styles.featureDot} />
                <div>
                  <h4 style={styles.featureTitle}>Rentabilidade e P&L</h4>
                  <p style={styles.featureSub}>
                    Visualiza os ganhos e perdas em valor absoluto ($) e em percentagem (%) posição a posição.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div style={styles.loginCard}>
            <h2 style={styles.heading}>
              {mode === "LOGIN" && "Iniciar Sessão"}
              {mode === "SIGNUP" && "Criar Conta"}
              {mode === "CONFIRM" && "Confirmar Email"}
            </h2>
            <p style={styles.subHeading}>
              {mode === "LOGIN" && "Acede ao painel da tua carteira de investimentos."}
              {mode === "SIGNUP" && "Escolhe o teu username e regista o teu email."}
              {mode === "CONFIRM" && "Valida o código de segurança enviado para o teu email."}
            </p>

            {error && <div style={styles.errorBox}>{error}</div>}

            <form onSubmit={handleSubmit} autoComplete="off" style={styles.form}>
              {mode !== "CONFIRM" ? (
                <>
                  <div style={styles.field}>
                    <label style={styles.label}>USERNAME</label>
                    <input
                      type="text"
                      name="sb_user_field"
                      required
                      autoComplete="off"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      style={styles.input}
                    />
                  </div>

                  {mode === "SIGNUP" && (
                    <div style={styles.field}>
                      <label style={styles.label}>EMAIL</label>
                      <input
                        type="email"
                        name="sb_email_field"
                        required
                        autoComplete="off"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        style={styles.input}
                      />
                    </div>
                  )}

                  <div style={styles.field}>
                    <label style={styles.label}>PASSWORD</label>
                    <input
                      type="password"
                      name="sb_pass_field"
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </>
              ) : (
                <div style={styles.field}>
                  <p style={styles.confirmText}>
                    Introduz o código enviado para <b>{email}</b>:
                  </p>
                  <label style={styles.label}>CÓDIGO DE 6 DÍGITOS</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    style={styles.input}
                  />
                </div>
              )}

              <button type="submit" disabled={loading} style={styles.submitBtn}>
                {loading
                  ? "A aguardar..."
                  : mode === "LOGIN"
                  ? "Entrar na Carteira"
                  : mode === "SIGNUP"
                  ? "Registar Conta"
                  : "Confirmar Código"}
              </button>
            </form>

            <div style={styles.cardFooter}>
              {mode === "LOGIN" ? (
                <span>
                  Ainda não tens conta?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("SIGNUP")}
                    style={styles.linkBtn}
                  >
                    Regista-te aqui
                  </button>
                </span>
              ) : (
                <span>
                  Já tens uma conta?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("LOGIN")}
                    style={styles.linkBtn}
                  >
                    Fazer Login
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Rodapé Técnico Maior */}
      <footer style={styles.pageFooter}>
        <div style={styles.pageFooterLeft}>
          <span style={styles.liveDot} />
          <span>DADOS DE MERCADO SINCRONIZADOS // FINNHUB & AWS DYNAMODB</span>
        </div>
        <div style={styles.pageFooterRight}>
          <span>STOCKBROKER CLOUD ARCHITECTURE</span>
        </div>
      </footer>
    </div>
  );
}

const styles = {
  viewport: {
    position: "relative",
    width: "100%",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    background: "radial-gradient(circle at 50% 35%, #0c1814 0%, #070b09 55%, #030504 100%)",
    overflow: "hidden",
    fontFamily: "'Inter', sans-serif",
  },
  tickerBar: {
    position: "relative",
    zIndex: 2,
    width: "100%",
    height: "68px",
    backgroundColor: "rgba(8, 12, 10, 0.92)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(16, 185, 129, 0.18)",
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
  },
  tickerItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0 2.4rem",
    borderRight: "1px solid rgba(255, 255, 255, 0.07)",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.95rem",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  tickerLogo: {
    width: "28px",
    height: "28px",
    borderRadius: "6px",
    backgroundColor: "#18181b",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    objectFit: "contain",
    padding: "2px",
    flexShrink: 0,
  },
  tickerSymbol: {
    fontWeight: 700,
    color: "#f8fafc",
    letterSpacing: "0.02em",
    fontSize: "0.96rem",
  },
  tickerPrice: {
    color: "#cbd5e1",
    fontWeight: 500,
    fontSize: "0.94rem",
  },
  tickerChange: {
    padding: "0.24rem 0.6rem",
    borderRadius: "6px",
    fontWeight: 600,
    fontSize: "0.84rem",
  },
  bgSvg: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 0,
  },
  mainStage: {
    position: "relative",
    zIndex: 1,
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
  },
  outerGlassFrame: {
    width: "100%",
    maxWidth: "1080px",
    minHeight: "560px",
    display: "grid",
    gridTemplateColumns: "1.25fr 0.95fr",
    gap: "3rem",
    alignItems: "center",
    padding: "3rem 3.2rem",
    borderRadius: "20px",
    backgroundColor: "rgba(12, 18, 15, 0.6)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    border: "1px solid rgba(16, 185, 129, 0.14)",
    boxShadow: "0 30px 80px rgba(0, 0, 0, 0.8)",
  },
  leftPresentation: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    paddingRight: "1rem",
  },
  brandRowLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
    marginBottom: "1.5rem",
  },
  logoText: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "1.2rem",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    color: "#ffffff",
  },
  heroTitle: {
    fontSize: "2.15rem",
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: "-0.025em",
    color: "#ffffff",
    marginBottom: "1rem",
  },
  heroDescription: {
    fontSize: "0.95rem",
    lineHeight: 1.6,
    color: "#a1a1aa",
    marginBottom: "2rem",
  },
  featureList: {
    display: "flex",
    flexDirection: "column",
    gap: "1.15rem",
  },
  featureItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.85rem",
  },
  featureDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "#10b981",
    marginTop: "0.4rem",
    flexShrink: 0,
  },
  featureTitle: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#f4f4f5",
    marginBottom: "0.2rem",
  },
  featureSub: {
    fontSize: "0.83rem",
    color: "#8e959e",
    lineHeight: 1.45,
  },
  loginCard: {
    width: "100%",
    maxWidth: "400px",
    justifySelf: "end",
    padding: "2.5rem 2.3rem",
    borderRadius: "16px",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    boxShadow: "0 20px 50px rgba(0, 0, 0, 0.65)",
  },
  heading: {
    fontSize: "1.45rem",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: "#ffffff",
    marginBottom: "0.35rem",
  },
  subHeading: {
    fontSize: "0.85rem",
    color: "#a1a1aa",
    marginBottom: "1.45rem",
    lineHeight: 1.4,
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
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "1.05rem",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  label: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.74rem",
    fontWeight: 500,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "#d4d4d8",
  },
  input: {
    width: "100%",
    height: "44px",
    padding: "0 0.9rem",
    backgroundColor: "#ffffff",
    color: "#090a0f",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.94rem",
    border: "none",
    borderRadius: "7px",
  },
  confirmText: {
    fontSize: "0.86rem",
    color: "#e4e4e7",
    marginBottom: "0.5rem",
    lineHeight: 1.45,
  },
  submitBtn: {
    marginTop: "0.5rem",
    height: "46px",
    backgroundColor: "#059669",
    color: "#ffffff",
    border: "1px solid rgba(16, 185, 129, 0.4)",
    borderRadius: "7px",
    fontSize: "0.94rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background-color 0.15s ease",
  },
  cardFooter: {
    marginTop: "1.75rem",
    paddingTop: "1.2rem",
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    textAlign: "center",
    fontSize: "0.95rem",
    color: "#cbd5e1",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#10b981",
    fontWeight: 600,
    fontSize: "0.95rem",
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: "4px",
    marginLeft: "0.25rem",
  },
  pageFooter: {
    position: "relative",
    zIndex: 2,
    width: "100%",
    padding: "1.15rem 2.5rem",
    backgroundColor: "rgba(6, 10, 8, 0.88)",
    backdropFilter: "blur(10px)",
    borderTop: "1px solid rgba(16, 185, 129, 0.16)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.85rem",
    color: "#94a3b8",
    letterSpacing: "0.03em",
  },
  pageFooterLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
  },
  liveDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "#10b981",
    boxShadow: "0 0 8px #10b981",
  },
  pageFooterRight: {
    color: "#64748b",
    fontWeight: 600,
  },
};