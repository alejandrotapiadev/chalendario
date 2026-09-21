import { useCallback, useEffect, useState } from 'react';
import type { UserDto } from '@calendar/shared';
import { App } from './App.tsx';
import { api, clearOfflineCache, setUnauthorizedHandler } from './api.ts';
import { AuthScreen } from './components/AuthScreen.tsx';

/** Decide entre la pantalla de acceso y la aplicación según haya sesión. */
export function Root() {
  // undefined = comprobando si ya hay sesión; null = sin sesión.
  const [user, setUser] = useState<UserDto | null | undefined>(undefined);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  // Si la sesión caduca mientras se usa la app, volver a la pantalla de acceso.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearOfflineCache();
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    // Aunque no hubiera red para cerrar la sesión, los datos guardados no se quedan en el navegador.
    clearOfflineCache();
    setUser(null);
  }, []);

  if (user === undefined) return null;
  if (user === null)
    return (
      <AuthScreen
        onAuthenticated={(next) => {
          clearOfflineCache(); // por si quedaban datos de otra cuenta
          setUser(next);
        }}
      />
    );
  // `key`: al cambiar de cuenta se descarta todo el estado de la anterior.
  return <App key={user.id} user={user} onLogout={() => void logout()} />;
}
