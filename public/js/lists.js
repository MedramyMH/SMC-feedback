// The choice lists shown in the app. Edit here to add/rename items.

export const MACHINES = ['SMC1', 'SMC2', 'SMC3', 'SMC4', 'SMC5', 'SMC6', 'SMC7', 'SMC8'];

export const STATIONS = ['Tape station', 'Clip station', 'Boards', 'Refill tape', 'Clip refill'];

// Components are shown in groups. Numbered groups render as a compact number pad.
export const COMPONENT_GROUPS = [
  { label: 'Cassette', items: Array.from({ length: 10 }, (_, i) => `Cassette ${i + 1}`), numbered: true },
  { label: 'Conveyor', items: Array.from({ length: 4 }, (_, i) => `Conveyor ${i + 1}`), numbered: true },
  { label: 'Other', items: ['Asyrile', 'Scanners', 'Main cabinet', 'AI'] },
];
export const COMPONENTS = COMPONENT_GROUPS.flatMap((g) => g.items);

export const TYPES = ['Maintenance', 'Adjustment', 'Spare part', 'Code', 'Programming'];

// Colour per intervention type (used for badges and stats)
export const TYPE_COLORS = {
  Maintenance: '#3b82f6',
  Adjustment: '#f59e0b',
  'Spare part': '#ef4444',
  Code: '#8b5cf6',
  Programming: '#10b981',
};

export const REMINDER_CHOICES = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120]; // minutes, 0 = off
