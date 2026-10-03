-- Conta compartilhada: o titular convida UMA pessoa; os dados continuam do titular.
CREATE TABLE app.household_members (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id    uuid NOT NULL UNIQUE REFERENCES app.subscribers(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  member_id   uuid UNIQUE REFERENCES app.subscribers(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
  invited_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CHECK ((status = 'active') = (member_id IS NOT NULL)),
  CHECK (member_id IS NULL OR member_id <> owner_id)
);
CREATE UNIQUE INDEX household_members_email_idx ON app.household_members (lower(email::text));
