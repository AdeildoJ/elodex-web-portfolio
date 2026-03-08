// src/app/jogadores/page.tsx
'use client';

import RequireAuth from '@/components/RequireAuth';
import UsuariosPageContent from '@/components/users/UsuariosPage';

export default function JogadoresPage() {
  return (
    <RequireAuth>
      <UsuariosPageContent />
    </RequireAuth>
  );
}

