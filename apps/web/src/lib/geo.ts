/**
 * Best-effort coordinates for weather lookups: browser geolocation when
 * granted (3s timeout), otherwise the Rangpur default used across the app.
 * Never blocks rendering — callers fall back on rejection.
 */
export async function getWeatherCoords(): Promise<{ lat: number; lng: number }> {
  if (typeof navigator !== "undefined" && navigator.geolocation) {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000, maximumAge: 300000 })
      );
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      // fall through to default
    }
  }
  return { lat: 25.9, lng: 89.1 };
}
