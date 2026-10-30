import { useEffect, useState } from "react";
import { Amplify } from "aws-amplify";
import { getCurrentUser, fetchAuthSession, signOut } from "aws-amplify/auth";
import Login from "./components/Login";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
});

export default function App() {
  const [user, setUser] = useState(null);
  const [tokenPreview, setTokenPreview] = useState("");
  const [checking, setChecking] = useState(true);

  async function checkUser() {
    try {
      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString() || "";
      setUser(currentUser);
      setTokenPreview(idToken.slice(0, 40) + "...");
    } catch {
      setUser(null);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    checkUser();
  }, []);

  async function handleLogout() {
    await signOut();
    setUser(null);
  }

  if (checking) return <div style={{ color: "#fff", padding: "2rem" }}>A carregar sessão...</div>;

  // Se não estiver autenticado, mostra a página de Login
  if (!user) {
    return <Login onLoginSuccess={checkUser} />;
  }

  // Se estiver autenticado, mostra o ecrã temporário de sucesso (onde vamos montar o Dashboard a seguir)
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0f172a", color: "#fff", padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Sessão Iniciada com Sucesso!</h1>
      <p><b>User ID (sub):</b> {user.userId}</p>
      <p><b>Token JWT gerado:</b> <code>{tokenPreview}</code></p>
      <button
        onClick={handleLogout}
        style={{ padding: "0.6rem 1.2rem", backgroundColor: "#ef4444", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
      >
        Terminar Sessão (Logout)
      </button>
    </div>
  );
}