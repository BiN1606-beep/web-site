BEGIN;

ALTER TABLE public.auth_users
    ADD COLUMN profile_picture text,
    ADD COLUMN profile_gender text CHECK (
        profile_gender IS NULL OR profile_gender IN (
            'Male',
            'Female',
            'Non-binary',
            'Prefer not to say',
            'Other'
        )
    ),
    ADD COLUMN profile_bio text NOT NULL DEFAULT '',
    ADD COLUMN profile_goals text NOT NULL DEFAULT '',
    ADD COLUMN profile_onboarding_seen boolean NOT NULL DEFAULT false;

COMMIT;