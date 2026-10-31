"""Hits per dictionary word across the UN statements, for the Dictionaries page.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-31 01:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('un_term_counts',
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('term', sa.String(length=80), nullable=False),
    sa.Column('hits', sa.Integer(), nullable=False),
    sa.Column('statements', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('kind', 'term')
    )


def downgrade():
    op.drop_table('un_term_counts')
