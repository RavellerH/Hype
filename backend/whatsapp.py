"""CallMeBot WhatsApp sender — free, no account needed beyond adding their contact."""
import urllib.parse

import httpx


async def send_whatsapp(phone: str, apikey: str, message: str) -> tuple[bool, str]:
    """Send a WhatsApp message via CallMeBot. Returns (success, status_text)."""
    if not phone or not apikey:
        return False, "WhatsApp not configured"
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(
                "https://api.callmebot.com/whatsapp.php",
                params={"phone": phone, "text": message, "apikey": apikey},
            )
            ok = r.status_code == 200
            return ok, r.text[:200]
    except Exception as e:
        return False, str(e)
