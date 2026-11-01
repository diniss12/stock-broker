import { useState, useEffect } from "react";
import { Amplify } from "aws-amplify";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";

// Configuração global do Cognito lida das variáveis de ambiente (ou do teu ficheiro aws-exports/config)
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
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    checkUserSession();
  }, []);

  async function checkUserSession() {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setCheckingAuth(false);
    }
  }

  async function handleLogout() {
    try {
      await signOut();
      setUser(null);
    } catch (err) {
      console.error("Erro ao terminar sessão:", err);
    }
  }

  if (checkingAuth) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: "#060908",
          color: "#94a3b8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Inter', sans-serif",
          fontSize: "0.9rem",
        }}
      >
        A sincronizar sessão...
      </div>
    );
  }

  return user ? (
    <Dashboard user={user} onLogout={handleLogout} />
  ) : (
    <Login onLoginSuccess={checkUserSession} />
  );
}