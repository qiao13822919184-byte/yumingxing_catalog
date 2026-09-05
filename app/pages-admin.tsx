import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminClient } from './admin/admin-client';

createRoot(document.getElementById('root')!).render(<React.StrictMode><AdminClient /></React.StrictMode>);
