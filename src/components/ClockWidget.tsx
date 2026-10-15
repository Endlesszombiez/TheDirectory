import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

export default function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const time =
    now?.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) || '--:--';
  return (
    <section className="widget clock-widget">
      <div className="widget-heading">
        <span>LOCAL TIME</span>
        <Clock3 size={15} />
      </div>
      <div className="clock-time">
        {time}
        <span className="clock-dot" />
      </div>
      <p>
        {now?.toLocaleDateString([], {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }) || 'Your local time'}
      </p>
    </section>
  );
}
