import dayjs from 'dayjs';

export function shouldRunForSchedule(schedule: string): boolean {
    const now = dayjs();
    const [minute, hour, dayOfMonth, month, dayOfWeek] = schedule.split(' ');

    // Check hour (we run at the start of each hour)
    if (hour !== '*' && parseInt(hour) !== now.hour()) {
        return false;
    }

    // Check day of week (0-6, where 0 is Sunday)
    if (dayOfWeek !== '*') {
        const currentDayOfWeek = now.day();
        const allowedDays = dayOfWeek.split(',').flatMap(d => {
            if (d.includes('-')) {
                const [start, end] = d.split('-').map(Number);
                return Array.from({length: end - start + 1}, (_, i) => start + i);
            }
            return [parseInt(d)];
        });

        if (!allowedDays.includes(currentDayOfWeek)) {
            return false;
        }
    }

    // For simplicity, we assume the minute is always 0 (start of hour)
    // and we don't check month/day of month as these are less common in our use case

    return true;
}
