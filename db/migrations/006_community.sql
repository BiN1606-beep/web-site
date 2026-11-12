ALTER TABLE public.auth_users
    ADD COLUMN profile_username text;

UPDATE public.auth_users
SET profile_username = 'user' || id
WHERE profile_username IS NULL;

ALTER TABLE public.auth_users
    ALTER COLUMN profile_username SET NOT NULL;

CREATE UNIQUE INDEX auth_users_profile_username_idx
    ON public.auth_users (profile_username);

CREATE FUNCTION public.set_default_profile_username()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.profile_username IS NULL OR NEW.profile_username = '' THEN
        NEW.profile_username := 'user' || NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER auth_users_default_profile_username
BEFORE INSERT ON public.auth_users
FOR EACH ROW
EXECUTE FUNCTION public.set_default_profile_username();

CREATE TABLE public.user_social_settings (
    user_id bigint PRIMARY KEY REFERENCES public.auth_users(id) ON DELETE CASCADE,
    profile_visibility text NOT NULL DEFAULT 'private'
        CHECK (profile_visibility IN ('public', 'private')),
    show_goals boolean NOT NULL DEFAULT false,
    show_progress boolean NOT NULL DEFAULT false,
    show_activity boolean NOT NULL DEFAULT false,
    allow_friend_requests boolean NOT NULL DEFAULT true,
    show_in_search boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.user_social_settings (user_id)
SELECT id FROM public.auth_users
ON CONFLICT (user_id) DO NOTHING;

CREATE FUNCTION public.create_default_social_settings()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.user_social_settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER auth_users_default_social_settings
AFTER INSERT ON public.auth_users
FOR EACH ROW
EXECUTE FUNCTION public.create_default_social_settings();

CREATE TABLE public.user_friendships (
    user_low bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    user_high bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    requested_by bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_low, user_high),
    CHECK (user_low < user_high),
    CHECK (requested_by = user_low OR requested_by = user_high)
);

CREATE INDEX user_friendships_recipient_idx
    ON public.user_friendships (user_high, status, requested_by);
CREATE INDEX user_friendships_requester_idx
    ON public.user_friendships (user_low, status, requested_by);

CREATE TABLE public.user_follows (
    follower_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    followed_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id <> followed_id)
);

CREATE INDEX user_follows_followed_idx ON public.user_follows (followed_id, follower_id);

CREATE TABLE public.user_blocks (
    blocker_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    blocked_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

CREATE TABLE public.user_reports (
    id bigserial PRIMARY KEY,
    reporter_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    reported_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'resolved')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (reporter_id <> reported_id)
);

CREATE TABLE public.community_activities (
    id bigserial PRIMARY KEY,
    actor_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    activity_type text NOT NULL CHECK (activity_type IN ('journey_started', 'milestone_completed')),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX community_activities_created_idx
    ON public.community_activities (created_at DESC, id DESC);
CREATE INDEX community_activities_actor_idx
    ON public.community_activities (actor_id, created_at DESC);

CREATE TABLE public.community_reactions (
    activity_id bigint NOT NULL REFERENCES public.community_activities(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    reaction text NOT NULL CHECK (reaction IN ('like', 'celebrate', 'support')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE public.user_notifications (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    actor_id bigint REFERENCES public.auth_users(id) ON DELETE SET NULL,
    notification_type text NOT NULL CHECK (
        notification_type IN (
            'friend_request',
            'friend_accepted',
            'new_follower',
            'milestone_completed',
            'reaction'
        )
    ),
    activity_id bigint REFERENCES public.community_activities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);

CREATE INDEX user_notifications_unread_idx
    ON public.user_notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;
CREATE INDEX user_notifications_user_idx
    ON public.user_notifications (user_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX user_notification_reaction_once_idx
    ON public.user_notifications (user_id, actor_id, notification_type, activity_id)
    WHERE notification_type = 'reaction';
