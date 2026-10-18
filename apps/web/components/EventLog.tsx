import type { Metrics } from "@/lib/api";

export function EventLog({ events }: { events: Metrics["recentEvents"] }) {
  return (
    <div className="panel">
      <h2>Recent events</h2>
      {events.length === 0 ? (
        <span className="muted">No events yet</span>
      ) : (
        <ul className="events">
          {events.map((event, index) => (
            <li key={`${event.createdAt}-${index}`}>
              <span className="muted">{new Date(event.createdAt).toLocaleTimeString()}</span>{" "}
              <span className="badge MISSING">{event.type}</span> {event.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
