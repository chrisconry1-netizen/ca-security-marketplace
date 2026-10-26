-- Additive enum value. PostgreSQL cannot use a new enum label in the
-- same transaction that adds it, so the messaging migration follows
-- this file and is the one that references 'conversation'.
alter type public.report_target add value if not exists 'conversation';
