import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import { Toaster } from './components/ui';
import './index.css';

// GitHub Pages serves the demo from a sub-path; strip the trailing slash for the router.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <App />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
