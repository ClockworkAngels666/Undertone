"""Full texts of the UN General Debate statements, for reading along and listening.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-28 19:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('un_texts',
    sa.Column('country_code', sa.String(length=8), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('body', sa.LargeBinary(), nullable=False),
    sa.PrimaryKeyConstraint('country_code', 'year')
    )


def downgrade():
    op.drop_table('un_texts')
