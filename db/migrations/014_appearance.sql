-- Each person's color theme and fonts, chosen in Settings > Appearance.
-- Saved per account so it follows you to every device. NULL means the
-- default look (Osiris paper, Fraunces and IBM Plex Sans).
-- lua/osiris/appearance.lua checks every value before it is saved.
ALTER TABLE public.auth_users
    ADD COLUMN IF NOT EXISTS appearance jsonb;
