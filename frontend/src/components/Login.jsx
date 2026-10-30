import { useState } from "react";
import { signIn, signUp, confirmSignUp } from "aws-amplify/auth";

const MARKET_TICKERS = [
  { symbol: "NVDA", name: "NVIDIA", price: "142.85", change: "+2.45%", up: true },
  { symbol: "AMZN", name: "Amazon", price: "210.40", change: "+1.18%", up: true },
  { symbol: "AAPL", name: "Apple", price: "234.10", change: "-0.64%", up: false },
  { symbol: "GOOGL", name: "Alphabet", price: "184.60", change: "+0.92%", up: true },
  { symbol: "MSFT", name: "Microsoft", price: "428.50", change: "-0.38%", up: false },
  { symbol: "TSLA", name: "Tesla", price: "258.90", change: "-1.85%", up: false },
];

function StockLogo({ symbol }) {
  switch (symbol) {
    case "NVDA":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#76B900" fillOpacity="0.18" />
          <path
            d="M5 12.5C7.2 8.5 12.5 7.5 16.5 10.5C14 13.5 9.8 14 7.5 12C9.5 10.2 12.8 10.5 14.2 11.8"
            stroke="#76B900"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="11.5" cy="11.5" r="1.5" fill="#76B900" />
        </svg>
      );
    case "AMZN":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#FF9900" fillOpacity="0.16" />
          <path
            d="M7.5 10.5C7.5 8.5 9.2 7.5 11.8 7.5C14.2 7.5 15.5 8.6 15.5 10.5V14.5M15.5 11.5C13 11.5 8.5 11.8 8.5 13.8C8.5 15 9.8 15.5 11.5 15.5C13.5 15.5 14.8 14.6 15.5 13.5"
            stroke="#ffffff"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M6.5 17C9.8 19.2 14.2 19.2 17.5 17M16 16.3L17.8 16.8L17.1 18.5"
            stroke="#FF9900"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "AAPL":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#ffffff" fillOpacity="0.12" />
          <path
            d="M15.2 13.2C15.2 11.4 16.6 10.5 16.7 10.4C15.8 9.1 14.5 8.9 14 8.9C12.9 8.8 11.8 9.6 11.2 9.6C10.6 9.6 9.7 8.9 8.8 8.9C7.5 8.9 6.4 9.7 5.8 10.8C4.5 13.1 5.5 16.5 6.7 18.2C7.3 19.1 8 20 9 20C9.9 20 10.3 19.4 11.4 19.4C12.5 19.4 12.8 20 13.8 20C14.8 20 15.4 19.1 16 18.2C16.7 17.2 17 16.2 17 16.1C16.9 16.1 15.2 15.4 15.2 13.2Z"
            fill="#f8fafc"
          />
          <path
            d="M13.2 7.3C13.7 6.7 14 5.8 13.9 5C13.1 5.1 12.2 5.5 11.7 6.1C11.2 6.6 10.8 7.5 10.9 8.3C11.8 8.4 12.7 7.9 13.2 7.3Z"
            fill="#f8fafc"
          />
        </svg>
      );
    case "GOOGL":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#4285F4" fillOpacity="0.15" />
          <path
            d="M12.2 11.2V13.2H16.6C16.3 15.1 14.6 16.5 12.2 16.5C9.5 16.5 7.3 14.3 7.3 11.6C7.3 8.9 9.5 6.7 12.2 6.7C13.5 6.7 14.6 7.2 15.5 8L17.1 6.4C15.8 5.2 14.1 4.5 12.2 4.5C8.3 4.5 5.1 7.7 5.1 11.6C5.1 15.5 8.3 18.7 12.2 18.7C16.3 18.7 19 15.8 19 11.8C19 11.5 18.9 11.3 18.9 11.2H12.2Z"
            fill="#60A5FA"
          />
        </svg>
      );
    case "MSFT":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#ffffff" fillOpacity="0.08" />
          <rect x="5.5" y="5.5" width="5.8" height="5.8" fill="#F25022" />
          <rect x="12.7" y="5.5" width="5.8" height="5.8" fill="#7FBA00" />
          <rect x="5.5" y="12.7" width="5.8" height="5.8" fill="#00A4EF" />
          <rect x="12.7" y="12.7" width="5.8" height="5.8" fill="#FFB900" />
        </svg>
      );
    case "TSLA":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#E82127" fillOpacity="0.18" />
          <path
            d="M5.5 7.2C8.5 6.3 15.5 6.3 18.5 7.2C18 8.2 17.2 8.6 16 8.7C14.8 8.4 13.5 8.3 12 8.3C10.5 8.3 9.2 8.4 8 8.7C6.8 8.6 6 8.2 5.5 7.2ZM12 9.5L9.8 10.2L12 18.5L14.2 10.2L12 9.5Z"
            fill="#EF4444"
          />
        </svg>
      );
    default:
      return null;
  }
}

export default function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState("LOGIN"); // LOGIN | SIGNUP | CONFIRM
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      {/* Barra de Cotações Aumentada no Topo com Logos */}
      <header style={styles.tickerBar}>
        <div style={styles.tickerInner}>
          {MARKET_TICKERS.map((t) => (
            <div key={t.symbol} style={styles.tickerItem}>
              <StockLogo symbol={t.symbol} />
              <span style={styles.tickerSymbol}>{t.symbol}</span>
              <span style={styles.tickerPrice}>${t.price}</span>
              <span
                style={{
                  ...styles.tickerChange,
                  color: t.up ? "#10b981" : "#ef4444",
                  backgroundColor: t.up
                    ? "rgba(16, 185, 129, 0.14)"
                    : "rgba(239, 68, 68, 0.14)",
                }}
              >
                {t.up ? "▲" : "▼"} {t.change}
              </span>
            </div>
          ))}
        </div>
      </header>

      {/* Fundo com Gráficos e Candlesticks em Verde Esmeralda com Fade para Preto */}
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

        {/* Grelha escura subtil */}
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

        {/* Candlesticks no fundo (Verdes Esmeralda e Vermelhos Escuros/Cinza) */}
        <g opacity="0.28">
          {/* Esquerda */}
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

          {/* Direita */}
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

        {/* Curva Principal de Tendência em Verde com Fade para Escuro */}
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

        {/* Linha tracejada secundária */}
        <path
          d="M-50 800 C 240 760, 430 650, 660 600 C 910 540, 1100 400, 1490 300"
          stroke="rgba(16, 185, 129, 0.22)"
          strokeWidth="2"
          strokeDasharray="8 8"
        />
      </svg>

      {/* Área Principal: Moldura com Apresentação à Esquerda + Login à Direita */}
      <main style={styles.mainStage}>
        <div style={styles.outerGlassFrame}>
          {/* Lado Esquerdo: Apresentação do Software */}
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

          {/* Lado Direito: Box de Login */}
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

            <div style={styles.footer}>
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
    background: "radial-gradient(circle at 50% 35%, #0c1814 0%, #070b09 55%, #030504 100%)",
    overflow: "hidden",
    fontFamily: "'Inter', sans-serif",
  },
  tickerBar: {
    position: "relative",
    zIndex: 2,
    width: "100%",
    height: "60px",
    backgroundColor: "rgba(8, 12, 10, 0.88)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(16, 185, 129, 0.14)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 2rem",
  },
  tickerInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    maxWidth: "1260px",
    gap: "1.5rem",
    overflowX: "auto",
  },
  tickerItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.9rem",
    whiteSpace: "nowrap",
  },
  tickerSymbol: {
    fontWeight: 700,
    color: "#f8fafc",
    letterSpacing: "0.02em",
    fontSize: "0.92rem",
  },
  tickerPrice: {
    color: "#cbd5e1",
    fontWeight: 500,
    fontSize: "0.9rem",
  },
  tickerChange: {
    padding: "0.22rem 0.55rem",
    borderRadius: "5px",
    fontWeight: 600,
    fontSize: "0.8rem",
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
    maxWidth: "390px",
    justifySelf: "end",
    padding: "2.4rem 2.2rem",
    borderRadius: "16px",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    boxShadow: "0 20px 50px rgba(0, 0, 0, 0.65)",
  },
  heading: {
    fontSize: "1.4rem",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: "#ffffff",
    marginBottom: "0.35rem",
  },
  subHeading: {
    fontSize: "0.82rem",
    color: "#a1a1aa",
    marginBottom: "1.4rem",
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
    fontSize: "0.72rem",
    fontWeight: 500,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "#d4d4d8",
  },
  input: {
    width: "100%",
    height: "42px",
    padding: "0 0.9rem",
    backgroundColor: "#ffffff",
    color: "#090a0f",
    fontFamily: "'Inter', sans-serif",
    fontSize: "0.92rem",
    border: "none",
    borderRadius: "7px",
  },
  confirmText: {
    fontSize: "0.84rem",
    color: "#e4e4e7",
    marginBottom: "0.5rem",
    lineHeight: 1.45,
  },
  submitBtn: {
    marginTop: "0.5rem",
    height: "44px",
    backgroundColor: "#059669",
    color: "#ffffff",
    border: "1px solid rgba(16, 185, 129, 0.4)",
    borderRadius: "7px",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background-color 0.15s ease",
  },
  footer: {
    marginTop: "1.4rem",
    textAlign: "center",
    fontSize: "0.8rem",
    color: "#a1a1aa",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#10b981",
    fontWeight: 600,
    fontSize: "0.8rem",
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
};