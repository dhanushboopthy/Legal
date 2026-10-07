"""The notification list and "mark all as read"."""
from app.models.notification import Notification
from app.services import notification_service
from tests.conftest import auth_header, make_user


async def _add(db, user, n, *, read=False):
    for i in range(n):
        db.add(Notification(user_id=user.id, message=f"Note {i}", kind="quote_sent", is_read=read))
    await db.commit()


async def test_read_all_marks_only_my_unread_notifications(client, db_session):
    me = await make_user(db_session)
    other = await make_user(db_session)
    await _add(db_session, me, 3)
    await _add(db_session, other, 2)

    resp = await client.post("/notifications/read-all", headers=auth_header(me))
    assert resp.status_code == 204

    mine = (await client.get("/notifications/me", headers=auth_header(me))).json()
    theirs = (await client.get("/notifications/me", headers=auth_header(other))).json()
    assert len(mine) == 3 and all(n["is_read"] for n in mine)
    assert len(theirs) == 2 and not any(n["is_read"] for n in theirs)


async def test_read_all_needs_a_signed_in_user(client):
    assert (await client.post("/notifications/read-all")).status_code == 401


async def test_the_list_is_capped_to_the_most_recent(client, db_session):
    me = await make_user(db_session)
    await _add(db_session, me, notification_service.LIST_LIMIT + 5)
    resp = await client.get("/notifications/me", headers=auth_header(me))
    assert len(resp.json()) == notification_service.LIST_LIMIT
