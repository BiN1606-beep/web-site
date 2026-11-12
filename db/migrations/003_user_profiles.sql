ALTER TABLE public.auth_users
    ADD COLUMN IF NOT EXISTS profile_picture text,
    ADD COLUMN IF NOT EXISTS profile_gender text CHECK (
        profile_gender IS NULL OR profile_gender IN (
            'Male',
            'Female',
            'Non-binary',
            'Prefer not to say',
            'Other'
        )
    ),
    ADD COLUMN IF NOT EXISTS profile_bio text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS profile_goals text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS profile_onboarding_seen boolean NOT NULL DEFAULT false;
