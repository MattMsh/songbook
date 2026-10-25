import type { Role, User } from '@songbook/shared';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { Banner, Card, Chip, Row, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/settings';

const roles: Role[] = ['admin', 'musician', 'member'];
const labels: Record<Role, string> = { admin: 'Адміністратор', musician: 'Музикант', member: 'Учасник' };

export default function UsersScreen() {
  const { user, ready } = useAuth();
  const t = useT();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    setUsers([]);
    setError(null);
    if (user?.role !== 'admin') return;
    setLoading(true);
    api<User[]>('/users')
      .then((rows) => { if (active) setUsers(rows); })
      .catch((e) => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, user?.role]));

  const changeRole = async (target: User, role: Role) => {
    if (busy || target.role === role) return;
    setBusy(true);
    try {
      const updated = await api<User>(`/users/${encodeURIComponent(target.id)}`, { method: 'PATCH', body: { role } });
      setUsers((rows) => rows.map((row) => row.id === updated.id ? updated : row));
    } catch (e) {
      Alert.alert(t('Помилка'), errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('Користувачі та ролі') }} />
      {!ready ? <T muted>{t('Завантаження…')}</T> : user?.role !== 'admin' ? <T>{t('Тільки для адміністратора')}</T> : (
        <>
          <T muted>{t('Адмінів з ADMIN_EMAILS не можна понизити тут')}</T>
          {error && <Banner kind="warn" text={error} />}
          {loading && <T muted>{t('Завантаження…')}</T>}
          {busy && <T muted>{t('Збереження…')}</T>}
          {!loading && !error && !users.length && <T muted>{t('Користувачів немає')}</T>}
          {users.map((row) => (
            <Card key={row.id}>
              <T style={{ fontWeight: '600' }}>{row.email}</T>
              {row.name && <T muted>{row.name}</T>}
              <Row wrap>
                {roles.map((role) => (
                  <Chip
                    key={role}
                    label={t(labels[role])}
                    active={row.role === role}
                    onPress={() => changeRole(row, role)}
                  />
                ))}
              </Row>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
