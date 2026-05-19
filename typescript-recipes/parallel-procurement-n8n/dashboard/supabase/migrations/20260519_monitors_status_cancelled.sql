-- ---------------------------------------------------------------------------
-- Migration: align monitors.status with Parallel V1 spelling and drop unused
-- tiers (finding 17).
--
-- Parallel V1 returns the double-l "cancelled". Our column previously
-- accepted single-l "canceled" plus two legacy tiers ('watching',
-- 'needs_review') that no code path ever wrote. The CHECK constraint was
-- harmless today but blocked a future "mirror remote status" feature.
--
-- Safe to run multiple times: we drop the constraint by predictable name,
-- normalize the values, then re-add it.
-- ---------------------------------------------------------------------------

begin;

-- Step 1: backfill any rows currently using the legacy spellings.
update public.monitors set status = 'cancelled' where status = 'canceled';
update public.monitors set status = 'active'    where status in ('watching', 'needs_review');

-- Step 2: replace the CHECK constraint with the tighter, V1-aligned set.
alter table public.monitors drop constraint if exists monitors_status_check;
alter table public.monitors
  add constraint monitors_status_check
  check (status in ('active', 'cancelled', 'failed'));

commit;
