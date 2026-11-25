"""Frozen Alpha catalog for a new SQLite database."""

from alembic import op

revision = "0001_alpha_baseline"
down_revision = None
branch_labels = None
depends_on = None

# Literal SQLite DDL, frozen against the independently recorded PB-07 C digest.
# Do not rebuild this revision from mutable ORM metadata.
DDL = (
    (
        "CREATE TABLE campaigns (\n"
        "\tid VARCHAR(36) NOT NULL, \n"
        "\tname VARCHAR(200) NOT NULL, \n"
        "\tcreated_at DATETIME NOT NULL, \n"
        "\tactive_scene_id VARCHAR(36), \n"
        "\tPRIMARY KEY (id)\n"
        ")"
    ),
    (
        "CREATE TABLE characters (\n"
        "\tid VARCHAR(36) NOT NULL, \n"
        "\tcampaign_id VARCHAR(36) NOT NULL, \n"
        "\towner_id VARCHAR(36), \n"
        "\tname VARCHAR(200) NOT NULL, \n"
        "\tsystem VARCHAR(40) NOT NULL, \n"
        "\tdata_json TEXT NOT NULL, \n"
        "\tsource_format VARCHAR(40), \n"
        "\tsource_json TEXT, \n"
        "\tcreated_at DATETIME NOT NULL, \n"
        "\tupdated_at DATETIME NOT NULL, \n"
        "\tPRIMARY KEY (id), \n"
        "\tFOREIGN KEY(campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE, \n"
        "\tFOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE SET NULL\n"
        ")"
    ),
    (
        "CREATE TABLE invites (\n"
        "\ttoken_hash VARCHAR(64) NOT NULL, \n"
        "\tcampaign_id VARCHAR(36) NOT NULL, \n"
        "\tuser_id VARCHAR(36), \n"
        "\tcreated_at DATETIME NOT NULL, \n"
        "\texpires_at DATETIME NOT NULL, \n"
        "\treusable BOOLEAN, \n"
        "\tpaused BOOLEAN, \n"
        "\ttoken_value VARCHAR(128), \n"
        "\tPRIMARY KEY (token_hash), \n"
        "\tFOREIGN KEY(campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE, \n"
        "\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE\n"
        ")"
    ),
    (
        "CREATE TABLE messages (\n"
        "\tid VARCHAR(36) NOT NULL, \n"
        "\tcampaign_id VARCHAR(36) NOT NULL, \n"
        "\tauthor VARCHAR(100) NOT NULL, \n"
        "\tauthor_id VARCHAR(36), \n"
        "\ttext TEXT NOT NULL, \n"
        "\tkind VARCHAR(20) NOT NULL, \n"
        "\troll_json TEXT, \n"
        "\tcreated_at DATETIME NOT NULL, \n"
        "\tPRIMARY KEY (id), \n"
        "\tFOREIGN KEY(campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE, \n"
        "\tFOREIGN KEY(author_id) REFERENCES users (id) ON DELETE SET NULL\n"
        ")"
    ),
    (
        "CREATE TABLE scene_folders (\n"
        "\tid VARCHAR(36) NOT NULL, \n"
        "\tcampaign_id VARCHAR(36) NOT NULL, \n"
        "\tname VARCHAR(200) NOT NULL, \n"
        "\tcreated_at DATETIME NOT NULL, \n"
        "\tPRIMARY KEY (id), \n"
        "\tFOREIGN KEY(campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE\n"
        ")"
    ),
    (
        "CREATE TABLE scenes (\n"
        "\tid VARCHAR(36) NOT NULL, \n"
        "\tcampaign_id VARCHAR(36) NOT NULL, \n"
        "\tname VARCHAR(200) NOT NULL, \n"
        "\tfolder_id VARCHAR(36), \n"
        "\tsort_order INTEGER, \n"
        "\tcreated_at DATETIME NOT NULL, \n"
        "\twidth INTEGER NOT NULL, \n"
        "\theight INTEGER NOT NULL, \n"
        "\tgrid_size INTEGER NOT NULL, \n"
        "\tgrid_type VARCHAR(20) NOT NULL, \n"
        "\tbackground_url VARCHAR(500), \n"
        "\tcombat_json TEXT, \n"
        "\tfog_json TEXT, \n"
        "\tseq INTEGER NOT NULL, \n"
        "\tPRIMARY KEY (id), \n"
        "\tFOREIGN KEY(campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE, \n"
        "\tFOREIGN KEY(folder_id) REFERENCES scene_folders (id) ON DELETE SET NULL\n"
        ")"
    ),
    (
        "CREATE TABLE sessions (\n"
        "\ttoken_hash VARCHAR(64) NOT NULL, \n"
        "\tuser_id VARCHAR(36) NOT NULL, \n"
        "\tcreated_at DATETIME NOT NULL, \n"
        "\tPRIMARY KEY (token_hash), \n"
        "\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE\n"
        ")"
    ),
    (
        "CREATE TABLE tokens (\n"
        "\tid VARCHAR(36) NOT NULL, \n"
        "\tscene_id VARCHAR(36) NOT NULL, \n"
        "\tname VARCHAR(200) NOT NULL, \n"
        "\tx FLOAT NOT NULL, \n"
        "\ty FLOAT NOT NULL, \n"
        "\tsize FLOAT NOT NULL, \n"
        "\tcolor VARCHAR(20) NOT NULL, \n"
        "\timage_url VARCHAR(500), \n"
        "\tlayer VARCHAR(20) NOT NULL, \n"
        "\towner_id VARCHAR(36), \n"
        "\tcharacter_id VARCHAR(36), \n"
        "\thp INTEGER, \n"
        "\tvision_range FLOAT NOT NULL, \n"
        "\temits_light FLOAT NOT NULL, \n"
        "\tPRIMARY KEY (id), \n"
        "\tFOREIGN KEY(scene_id) REFERENCES scenes (id) ON DELETE CASCADE, \n"
        "\tFOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE SET NULL, \n"
        "\tFOREIGN KEY(character_id) REFERENCES characters (id) ON DELETE SET NULL\n"
        ")"
    ),
    (
        "CREATE TABLE users (\n"
        "\tid VARCHAR(36) NOT NULL, \n"
        "\tcampaign_id VARCHAR(36) NOT NULL, \n"
        "\tname VARCHAR(100) NOT NULL, \n"
        "\tpassword_hash VARCHAR(200) NOT NULL, \n"
        "\tis_gm BOOLEAN NOT NULL, \n"
        "\tcreated_at DATETIME NOT NULL, \n"
        "\tPRIMARY KEY (id), \n"
        "\tUNIQUE (campaign_id, name), \n"
        "\tFOREIGN KEY(campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE\n"
        ")"
    ),
    (
        "CREATE TABLE walls (\n"
        "\tid VARCHAR(36) NOT NULL, \n"
        "\tscene_id VARCHAR(36) NOT NULL, \n"
        "\tx1 FLOAT NOT NULL, \n"
        "\ty1 FLOAT NOT NULL, \n"
        "\tx2 FLOAT NOT NULL, \n"
        "\ty2 FLOAT NOT NULL, \n"
        "\tkind VARCHAR(20) NOT NULL, \n"
        "\tdoor_state VARCHAR(20) NOT NULL, \n"
        "\tblocks_movement BOOLEAN NOT NULL, \n"
        "\tblocks_sight BOOLEAN NOT NULL, \n"
        "\tblocks_sound BOOLEAN NOT NULL, \n"
        "\towner_id VARCHAR(36), \n"
        "\tPRIMARY KEY (id), \n"
        "\tFOREIGN KEY(scene_id) REFERENCES scenes (id) ON DELETE CASCADE, \n"
        "\tFOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE SET NULL\n"
        ")"
    ),
    "CREATE INDEX ix_characters_campaign_id ON characters (campaign_id)",
    "CREATE INDEX ix_invites_campaign_id ON invites (campaign_id)",
    "CREATE INDEX ix_messages_campaign_id ON messages (campaign_id)",
    "CREATE INDEX ix_scene_folders_campaign_id ON scene_folders (campaign_id)",
    "CREATE INDEX ix_sessions_user_id ON sessions (user_id)",
    "CREATE INDEX ix_tokens_scene_id ON tokens (scene_id)",
    "CREATE INDEX ix_users_campaign_id ON users (campaign_id)",
    "CREATE INDEX ix_walls_scene_id ON walls (scene_id)",
)


def upgrade() -> None:
    connection = op.get_bind()
    for statement in DDL:
        connection.exec_driver_sql(statement)


def downgrade() -> None:
    raise RuntimeError("Laterna does not provide destructive schema downgrades.")
