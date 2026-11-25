import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { UnsavedChangesProvider } from './context/UnsavedChangesContext.jsx';
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

function RootLayout() {
  return (
    <AuthProvider>
      <UnsavedChangesProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </UnsavedChangesProvider>
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/iniciar-sesion', element: <Login /> },
      { path: '/registro', element: <Register /> },
      { path: '/recuperar', element: <ForgotPassword /> },
      { path: '/restablecer', element: <ResetPassword /> },
      {
        path: '/diario',
        element: (
          <ProtectedRoute>
            <Diary />
          </ProtectedRoute>
        ),
      },
      {
        path: '/perfil',
        element: (
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin',
        element: (
          <ProtectedRoute requireAdmin>
            <Admin />
          </ProtectedRoute>
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

export default App;
