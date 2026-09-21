from decimal import Decimal


def paise_from_rupees(amount) -> int:
    """Rupees (int, Decimal or numeric string) to whole paise, without float error."""
    return int((Decimal(str(amount)) * 100).to_integral_value())


def format_inr(amount_paise: int) -> str:
    """₹2,50,000 style (Indian digit grouping); paise shown only when non-zero."""
    rupees, paise = divmod(amount_paise, 100)
    digits = str(rupees)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups + [tail])
    return f"₹{digits}.{paise:02d}" if paise else f"₹{digits}"
