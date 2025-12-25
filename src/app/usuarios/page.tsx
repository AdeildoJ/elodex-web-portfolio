// src/app/usuarios/page.tsx
'use client';

import RequireAuth from '@/components/RequireAuth';
import UsuariosPageContent from '@/components/users/UsuariosPage';

export default function UsuariosPage() {
  return (
    <RequireAuth>
      <UsuariosPageContent />
    </RequireAuth>
  );
}
