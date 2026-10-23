"""Initial schema: countries, UN General Debate tables, pipeline runs, user datasets.

Revision ID: 0001
Revises:
Create Date: 2026-10-22 20:27:31.257115
"""
from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('countries',
    sa.Column('code', sa.String(length=8), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.PrimaryKeyConstraint('code')
    )
    op.create_table('datasets',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('edit_token_hash', sa.String(length=64), nullable=False),
    sa.Column('hostile_terms', sa.JSON(), nullable=False),
    sa.Column('coop_terms', sa.JSON(), nullable=False),
    sa.Column('keywords', sa.JSON(), nullable=False),
    sa.Column('uses_default_dictionaries', sa.Boolean(), nullable=False),
    sa.Column('scoring_version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('pipeline_runs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=200), nullable=False),
    sa.Column('source_md5', sa.String(length=32), nullable=True),
    sa.Column('dictionary_fingerprint', sa.String(length=64), nullable=False),
    sa.Column('speeches', sa.Integer(), nullable=False),
    sa.Column('countries', sa.Integer(), nullable=False),
    sa.Column('first_year', sa.Integer(), nullable=False),
    sa.Column('last_year', sa.Integer(), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('un_country_years',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('country_code', sa.String(length=8), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('session', sa.Integer(), nullable=False),
    sa.Column('documents', sa.Integer(), nullable=False),
    sa.Column('hostility', sa.Float(), nullable=True),
    sa.Column('cooperation', sa.Float(), nullable=True),
    sa.Column('tone_balance', sa.Float(), nullable=True),
    sa.Column('vader_mean', sa.Float(), nullable=True),
    sa.Column('negative_share', sa.Float(), nullable=True),
    sa.Column('words', sa.Integer(), nullable=False),
    sa.Column('sentences', sa.Integer(), nullable=False),
    sa.Column('hostile_hits', sa.Integer(), nullable=False),
    sa.Column('coop_hits', sa.Integer(), nullable=False),
    sa.Column('vader_sum', sa.Float(), nullable=False),
    sa.Column('negative_sentences', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('country_code', 'year', name='uq_un_country_year')
    )
    with op.batch_alter_table('un_country_years', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_un_country_years_country_code'), ['country_code'], unique=False)
        batch_op.create_index(batch_op.f('ix_un_country_years_year'), ['year'], unique=False)

    op.create_table('un_sentences',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('country_code', sa.String(length=8), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('score', sa.Float(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('sentence', sa.Text(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('un_sentences', schema=None) as batch_op:
        batch_op.create_index('ix_un_sentences_country_year', ['country_code', 'year'], unique=False)

    op.create_table('documents',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('dataset_id', sa.String(length=36), nullable=False),
    sa.Column('country_code', sa.String(length=8), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=200), nullable=True),
    sa.Column('title', sa.String(length=300), nullable=True),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('keyword_counts', sa.JSON(), nullable=False),
    sa.Column('scoring_version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('words', sa.Integer(), nullable=False),
    sa.Column('sentences', sa.Integer(), nullable=False),
    sa.Column('hostile_hits', sa.Integer(), nullable=False),
    sa.Column('coop_hits', sa.Integer(), nullable=False),
    sa.Column('vader_sum', sa.Float(), nullable=False),
    sa.Column('negative_sentences', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['dataset_id'], ['datasets.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('documents', schema=None) as batch_op:
        batch_op.create_index('ix_documents_dataset_country_year', ['dataset_id', 'country_code', 'year'], unique=False)

    op.create_table('un_keyword_rates',
    sa.Column('country_year_id', sa.Integer(), nullable=False),
    sa.Column('keyword', sa.String(length=80), nullable=False),
    sa.Column('hits', sa.Integer(), nullable=False),
    sa.Column('per_1000', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['country_year_id'], ['un_country_years.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('country_year_id', 'keyword')
    )
    with op.batch_alter_table('un_keyword_rates', schema=None) as batch_op:
        batch_op.create_index('ix_un_keyword_rates_keyword', ['keyword'], unique=False)



def downgrade():
    with op.batch_alter_table('un_keyword_rates', schema=None) as batch_op:
        batch_op.drop_index('ix_un_keyword_rates_keyword')

    op.drop_table('un_keyword_rates')
    with op.batch_alter_table('documents', schema=None) as batch_op:
        batch_op.drop_index('ix_documents_dataset_country_year')

    op.drop_table('documents')
    with op.batch_alter_table('un_sentences', schema=None) as batch_op:
        batch_op.drop_index('ix_un_sentences_country_year')

    op.drop_table('un_sentences')
    with op.batch_alter_table('un_country_years', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_un_country_years_year'))
        batch_op.drop_index(batch_op.f('ix_un_country_years_country_code'))

    op.drop_table('un_country_years')
    op.drop_table('pipeline_runs')
    op.drop_table('datasets')
    op.drop_table('countries')
