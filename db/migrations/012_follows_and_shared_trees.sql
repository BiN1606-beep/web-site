-- Connecting people works like TikTok now: you follow someone, and when you
-- follow each other you are friends. A private profile has to accept a
-- follow first (a follow request). Friends can grow a shared tree, which
-- only grows on the days both of them water it.

-- 1. Follows get a status: 'pending' is a follow request to a private
--    profile, 'accepted' is a real follow.
ALTER TABLE public.user_follows
    ADD COLUMN status text NOT NULL DEFAULT 'accepted'
        CHECK (status IN ('pending', 'accepted'));

-- Until now anyone could follow a private profile without asking. Those
-- follows were never approved, so they become requests the owner can
-- accept, except between people who were already friends.
UPDATE public.user_follows follow
SET status = 'pending'
FROM public.user_social_settings settings
WHERE settings.user_id = follow.followed_id
  AND settings.profile_visibility = 'private'
  AND NOT EXISTS (
      SELECT 1 FROM public.user_friendships friendship
      WHERE friendship.status = 'accepted'
        AND friendship.user_low = LEAST(follow.follower_id, follow.followed_id)
        AND friendship.user_high = GREATEST(follow.follower_id, follow.followed_id)
  );

-- 2. Old friendships become two follows, one in each direction.
INSERT INTO public.user_follows (follower_id, followed_id, status, created_at)
SELECT user_low, user_high, 'accepted', created_at
FROM public.user_friendships WHERE status = 'accepted'
UNION ALL
SELECT user_high, user_low, 'accepted', created_at
FROM public.user_friendships WHERE status = 'accepted'
ON CONFLICT (follower_id, followed_id) DO UPDATE SET status = 'accepted';

-- Open friend requests become follow requests (a plain follow when the
-- other profile is public).
INSERT INTO public.user_follows (follower_id, followed_id, status, created_at)
SELECT request.requested_by, request.target,
    CASE WHEN COALESCE(settings.profile_visibility, 'private') = 'public'
        THEN 'accepted' ELSE 'pending' END,
    request.created_at
FROM (
    SELECT requested_by, created_at,
        CASE WHEN requested_by = user_low THEN user_high ELSE user_low END AS target
    FROM public.user_friendships
    WHERE status = 'pending'
) request
LEFT JOIN public.user_social_settings settings ON settings.user_id = request.target
ON CONFLICT (follower_id, followed_id) DO NOTHING;

DROP TABLE public.user_friendships;

CREATE INDEX user_follows_requests_idx
    ON public.user_follows (followed_id, status, created_at DESC);

-- Friends are two people who follow each other. The view lists every
-- friendship twice, once from each side, so a query only has to ask
-- "WHERE user_id = me".
CREATE VIEW public.user_friends AS
SELECT mine.follower_id AS user_id, mine.followed_id AS friend_id
FROM public.user_follows mine
JOIN public.user_follows theirs
  ON theirs.follower_id = mine.followed_id
 AND theirs.followed_id = mine.follower_id
WHERE mine.status = 'accepted' AND theirs.status = 'accepted';

-- 3. Shared trees. One tree per pair at a time; the two ids are stored
--    smallest first, like the old friendships, so a pair has one row.
CREATE TABLE public.shared_trees (
    id bigserial PRIMARY KEY,
    user_low bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    user_high bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    planted_by bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
    status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'growing', 'ended')),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    ended_at timestamptz,
    CHECK (user_low < user_high),
    CHECK (planted_by = user_low OR planted_by = user_high)
);

CREATE UNIQUE INDEX shared_trees_one_per_pair_idx
    ON public.shared_trees (user_low, user_high)
    WHERE status <> 'ended';
CREATE INDEX shared_trees_high_idx ON public.shared_trees (user_high);

-- One watering per person per day: a short line about what they did.
-- The tree grows one step for every day that has a watering from both.
CREATE TABLE public.shared_tree_waterings (
    tree_id bigint NOT NULL REFERENCES public.shared_trees(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    day date NOT NULL,
    note text NOT NULL CHECK (length(note) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tree_id, user_id, day)
);

-- A side quest saves the streak on a day your friend didn't show up: you
-- checked in, they didn't, so you do one small extra task instead. It
-- keeps the streak alive but does not grow the network. It can't save two
-- days in a row, because growing together is teamwork. One per goal and
-- day.
CREATE TABLE public.shared_tree_side_quests (
    tree_id bigint NOT NULL REFERENCES public.shared_trees(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    day date NOT NULL,
    quest text NOT NULL CHECK (length(quest) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tree_id, day)
);

-- A nudge: "hop on and check in!" sent to a friend who hasn't checked in
-- on your shared goal today. One per person, tree and day. It shows in the
-- friend's inbox right away, and reminders/send_reminders.py also sends it
-- to their phone as a push notification (pushed_at marks it as sent).
CREATE TABLE public.shared_tree_nudges (
    tree_id bigint NOT NULL REFERENCES public.shared_trees(id) ON DELETE CASCADE,
    from_user bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    to_user bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    day date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    pushed_at timestamptz,
    PRIMARY KEY (tree_id, from_user, day)
);

CREATE INDEX shared_tree_nudges_unpushed_idx
    ON public.shared_tree_nudges (created_at)
    WHERE pushed_at IS NULL;

-- 4. New notification kinds. Old friend notifications get their new names.
ALTER TABLE public.user_notifications
    DROP CONSTRAINT user_notifications_notification_type_check;

UPDATE public.user_notifications SET notification_type = 'follow_request'
WHERE notification_type = 'friend_request';
UPDATE public.user_notifications SET notification_type = 'follow_accepted'
WHERE notification_type = 'friend_accepted';

ALTER TABLE public.user_notifications
    ADD CONSTRAINT user_notifications_notification_type_check CHECK (
        notification_type IN (
            'follow_request',
            'follow_accepted',
            'new_follower',
            'new_friend',
            'milestone_completed',
            'reaction',
            'tree_invite',
            'tree_started',
            'tree_watered',
            'tree_grew',
            'tree_nudge'
        )
    );
