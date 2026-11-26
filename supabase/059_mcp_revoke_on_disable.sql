-- ============================================================================
--  Отключение на «Команде» отзывает все AI-подключения человека (23.11.2026, Даниил: «Да, делай»).
--  Выполнить после 058_cabinet_bm.sql. Идемпотентный.
-- ============================================================================
--
--  Раньше отключение резало MCP только на каждом вызове (authenticate и refreshTokens в
--  lib/mcp/store.ts смотрят status), а сами подключения оставались живыми: включили человека
--  снова — оживали refresh-токены (до 30 дней) и личные ключи без срока. Теперь при смене
--  статуса на disabled всем его mcp_tokens ставится revoked_at. Включение ничего не оживляет —
--  человек подключает Claude или Codex заново.
--
--  Триггер, а не правка admin_update_profile: срабатывает при любой смене статуса (функция
--  «Команды», SQL-редактор, будущий код), и функцию не надо пересоздавать — её поведение
--  (p_legacy, последний владелец, «себя нельзя») остаётся как есть.

create or replace function public.revoke_mcp_on_disable()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.mcp_tokens set revoked_at = now() where user_id = new.id and revoked_at is null;
  return null;
end $$;

revoke all on function public.revoke_mcp_on_disable() from public, anon, authenticated;

drop trigger if exists profiles_revoke_mcp on public.profiles;
create trigger profiles_revoke_mcp
  after update of status on public.profiles
  for each row
  when (new.status = 'disabled' and old.status is distinct from 'disabled')
  execute function public.revoke_mcp_on_disable();

-- Кто уже отключён — его подключения тоже не должны ожить при включении (на 23.11.2026 таких нет).
update public.mcp_tokens t set revoked_at = now()
  from public.profiles p
 where p.id = t.user_id and p.status = 'disabled' and t.revoked_at is null;
