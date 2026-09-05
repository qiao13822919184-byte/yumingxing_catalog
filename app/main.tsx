import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { CatalogClient } from './catalog-client';
import './globals.css';
const Admin = lazy(() => import('./admin/admin-client').then(m => ({ default: m.AdminClient })));
function App() {
  if (window.location.pathname.startsWith('/admin')) return <Suspense fallback={<div style={{ padding: 40 }}>正在打开管理后台…</div>}><Admin /></Suspense>;
  return <CatalogClient products={[]} />;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
