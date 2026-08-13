type Manager = { name: string; initials: string };

export function ManagerSelect({ value, onChange, managers, className = "" }: { value: string; onChange: (value: string) => void; managers: Manager[]; className?: string }) {
  const options = managers.filter((manager) => manager.name.trim());
  return <select required value={value} onChange={(event) => onChange(event.target.value)} className={className}><option value="">SELECT MANAGER</option>{options.map((manager, index) => { const label = manager.initials.trim() ? `${manager.initials} — ${manager.name}` : manager.name; return <option key={`${manager.initials}-${manager.name}-${index}`} value={manager.initials.trim() || manager.name}>{label}</option>; })}</select>;
}
