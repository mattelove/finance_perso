-- =========================================================
-- Finances perso — schéma Supabase
-- À coller tel quel dans Supabase > SQL Editor, puis « Run ».
-- Le script peut être relancé sans risque : il ne supprime aucune donnée.
--
-- Chaque table porte une colonne user_id. La Row Level Security (RLS) est
-- activée partout, et les policies n'autorisent un utilisateur connecté qu'à
-- lire, ajouter, modifier et supprimer ses propres lignes. Le rôle anonyme
-- (visiteur non connecté) n'a accès à rien.
-- =========================================================


-- ---------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------

create table if not exists public.transactions (
  user_id           uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id                text    not null,                -- identifiant généré par l'app (UUID)
  type              text    not null check (type in ('depense', 'revenu', 'investissement', 'transfert')),
  name              text    not null,
  amount            numeric not null check (amount >= 0),
  category          text    not null,
  date              date    not null,
  created_at_ms     bigint  not null,                -- horodatage de création, départage les égalités de date
  linked_expense_id text,                            -- remboursement : id de la dépense remboursée
  direction         text    check (direction in ('vers-epargne', 'depuis-epargne')),  -- transferts uniquement
  primary key (user_id, id)
);

alter table public.transactions enable row level security;

drop policy if exists "transactions: lecture de ses lignes"      on public.transactions;
drop policy if exists "transactions: ajout de ses lignes"        on public.transactions;
drop policy if exists "transactions: modification de ses lignes" on public.transactions;
drop policy if exists "transactions: suppression de ses lignes"  on public.transactions;

create policy "transactions: lecture de ses lignes" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "transactions: ajout de ses lignes" on public.transactions
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "transactions: modification de ses lignes" on public.transactions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "transactions: suppression de ses lignes" on public.transactions
  for delete to authenticated using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------
-- Catégories personnalisées : une ligne par type
-- ---------------------------------------------------------

create table if not exists public.categories (
  user_id uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  type    text   not null check (type in ('depense', 'revenu', 'investissement', 'transfert')),
  labels  text[] not null default '{}',               -- libellés, dans l'ordre d'affichage
  primary key (user_id, type)
);

alter table public.categories enable row level security;

drop policy if exists "categories: lecture de ses lignes"      on public.categories;
drop policy if exists "categories: ajout de ses lignes"        on public.categories;
drop policy if exists "categories: modification de ses lignes" on public.categories;
drop policy if exists "categories: suppression de ses lignes"  on public.categories;

create policy "categories: lecture de ses lignes" on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "categories: ajout de ses lignes" on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "categories: modification de ses lignes" on public.categories
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "categories: suppression de ses lignes" on public.categories
  for delete to authenticated using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------
-- Soldes de départ des comptes : une ligne par compte
-- ---------------------------------------------------------

create table if not exists public.accounts (
  user_id       uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  account       text    not null check (account in ('courant', 'epargne')),
  start_balance numeric not null default 0,
  primary key (user_id, account)
);

alter table public.accounts enable row level security;

drop policy if exists "accounts: lecture de ses lignes"      on public.accounts;
drop policy if exists "accounts: ajout de ses lignes"        on public.accounts;
drop policy if exists "accounts: modification de ses lignes" on public.accounts;
drop policy if exists "accounts: suppression de ses lignes"  on public.accounts;

create policy "accounts: lecture de ses lignes" on public.accounts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "accounts: ajout de ses lignes" on public.accounts
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "accounts: modification de ses lignes" on public.accounts
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "accounts: suppression de ses lignes" on public.accounts
  for delete to authenticated using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------
-- Droits d'accès via l'API : utilisateurs connectés seulement
-- ---------------------------------------------------------

revoke all on public.transactions, public.categories, public.accounts from anon;
grant select, insert, update, delete on public.transactions, public.categories, public.accounts to authenticated;
