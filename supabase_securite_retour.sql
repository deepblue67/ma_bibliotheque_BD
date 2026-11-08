-- ============================================================================
-- Ma Bibliothèque BD — RETOUR ARRIÈRE de la version 3.2 (verrou des écritures)
-- À n'utiliser qu'en cas de problème : remet les règles d'avant la 3.2, où la clé
-- publique pouvait lire et écrire les trois tables. Supabase → SQL Editor → Run.
-- Pour reverrouiller ensuite : relancer supabase_securite.sql.
-- ============================================================================

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('bd_status', 'bd_volume_status', 'bd_overrides')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "public read"   on public.bd_status for select using (true);
create policy "public upsert" on public.bd_status for insert with check (true);
create policy "public update" on public.bd_status for update using (true);

create policy "public read"   on public.bd_volume_status for select using (true);
create policy "public upsert" on public.bd_volume_status for insert with check (true);
create policy "public update" on public.bd_volume_status for update using (true);

create policy "public read"   on public.bd_overrides for select using (true);
create policy "public insert" on public.bd_overrides for insert with check (true);
create policy "public update" on public.bd_overrides for update using (true);
create policy "public delete" on public.bd_overrides for delete using (true);

select tablename, policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename in ('bd_status', 'bd_volume_status', 'bd_overrides')
order by tablename, cmd;
