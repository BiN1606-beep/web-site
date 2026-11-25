-- How each person likes their progress network to look: the shape
-- (web, tree, galaxy, orbit or lines), colors, background and the pull
-- of the lines. Saved per account so it follows you to every device.
-- NULL means the default look. lua/osiris/network_style.lua checks every
-- value before it is saved, so the JSON is always small and known.
ALTER TABLE public.auth_users
    ADD COLUMN IF NOT EXISTS network_style jsonb;
