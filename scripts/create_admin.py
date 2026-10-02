"""
Create the advocate's account (role `super_admin`), or make an existing
account one. Registration only ever creates lawyer accounts, so this is how
the first advocate gets in:

    python -m scripts.create_admin
    python -m scripts.create_admin --email advocate@example.com

Asks for anything not given on the command line, and the password always
(never as an argument, so it can't end up in shell history). Run after
migrations and `scripts.seed_roles`.
"""
import argparse
import asyncio
import getpass
import sys

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.passwords import password_problem
from app.core.security import hash_password
from app.database import AsyncSessionLocal
from app.models.role import Role
from app.models.user import User
from app.services import audit_service

ROLE = "super_admin"


def _ask(prompt: str, given: str | None) -> str:
    value = (given or "").strip()
    while not value:
        value = input(prompt).strip()
    return value


def _ask_password(email: str) -> str:
    while True:
        password = getpass.getpass("Password: ")
        problem = password_problem(password, email)
        if problem:
            print(problem)
            continue
        if getpass.getpass("Type it again: ") != password:
            print("The two passwords don't match.")
            continue
        return password


async def create_admin(email: str | None, name: str | None, bar_council_id: str | None) -> int:
    async with AsyncSessionLocal() as db:
        role = (await db.execute(select(Role).where(Role.name == ROLE))).scalar_one_or_none()
        if role is None:
            print(f"The '{ROLE}' role doesn't exist yet. Run `python -m scripts.seed_roles` first.")
            return 1

        email = _ask("Email: ", email).lower()
        user = (await db.execute(
            select(User).options(selectinload(User.role)).where(User.email == email)
        )).scalar_one_or_none()

        if user is not None:
            if user.role.name == ROLE and user.is_active and user.removed_at is None:
                print(f"{email} is already an active advocate. Nothing to do.")
                return 0
            answer = input(f"{email} already has an account ({user.role.name}). Make it the advocate? [y/N] ")
            if answer.strip().lower() not in ("y", "yes"):
                print("Nothing changed.")
                return 1
            user.role_id = role.id
            if not user.bar_council_id:
                user.bar_council_id = _ask("Bar Council enrolment number: ", bar_council_id)
        else:
            user = User(
                full_name=_ask("Full name: ", name),
                email=email,
                bar_council_id=_ask("Bar Council enrolment number: ", bar_council_id),
                hashed_password=hash_password(_ask_password(email)),
                role_id=role.id,
            )
            db.add(user)

        # Verified and approved: nobody else exists yet to approve the first advocate.
        user.is_active = True
        user.is_verified = True
        user.removed_at = None
        await db.flush()
        await audit_service.log_action(
            db, user_id=None, action="user.admin_created", entity_type="user",
            entity_id=str(user.id), metadata={"via": "scripts.create_admin"},
        )
        await db.commit()
        print(f"Done. {email} can now sign in as the advocate.")
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or promote the advocate's account.")
    parser.add_argument("--email")
    parser.add_argument("--name")
    parser.add_argument("--bar-council-id")
    args = parser.parse_args()
    try:
        sys.exit(asyncio.run(create_admin(args.email, args.name, args.bar_council_id)))
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled. Nothing changed.")
        sys.exit(1)


if __name__ == "__main__":
    main()
