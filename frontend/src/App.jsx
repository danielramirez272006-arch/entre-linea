import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { AppShell } from './components/layout/AppShell.jsx';
import { ProtectedRoute } from './routes/ProtectedRoute.jsx';

import { Home } from './pages/Home.jsx';
import { Login } from './pages/Login.jsx';
import { Register } from './pages/Register.jsx';
import { ForgotPassword } from './pages/ForgotPassword.jsx';
import { ResetPassword } from './pages/ResetPassword.jsx';
import { Diary } from './pages/Diary.jsx';
import { Profile } from './pages/Profile.jsx';
import { Admin } from './pages/Admin.jsx';
import { NotFound } from './pages/NotFound.jsx';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/iniciar-sesion" element={<Login />} />
            <Route path="/registro" element={<Register />} />
            <Route path="/recuperar" element={<ForgotPassword />} />
            <Route path="/restablecer" element={<ResetPassword />} />

            <Route
              path="/diario"
              element={
                <ProtectedRoute>
                  <Diary />
                </ProtectedRoute>
              }
            />
            <Route
              path="/perfil"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute requireAdmin>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppShell>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
