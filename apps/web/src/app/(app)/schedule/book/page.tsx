import type { Metadata } from "next";
import { getAppointment, getPatient, listServices, loadSchedulingData } from "@vetrix/db/runtime";
import { PageHeader } from "@/components/patterns/page-header";
import { orNotFound, requirePage } from "@/features/clients/access";
import { BookingFlow } from "@/features/schedule/booking-flow";
import { formatDayLong, formatTime } from "@/features/schedule/format";
import { clinicToday } from "@/lib/clinic-date";

export const metadata: Metadata = { title: "Book a visit · Vetrix" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BookPage({ searchParams }: { searchParams: Promise<{ patient?: string; reschedule?: string }> }) {
  const shell = await requirePage("schedule.manage");
  const sp = await searchParams;
  const tz = shell.location.timezone;
  const today = clinicToday(tz);
  const [services, data] = await Promise.all([listServices(shell.clinic, shell.location.id), loadSchedulingData(shell.clinic, shell.location.id, today, 1)]);

  const visit = sp.reschedule && UUID.test(sp.reschedule) ? await orNotFound(getAppointment(shell.clinic, shell.location.id, sp.reschedule)) : null;
  const petId = visit?.patient_id ?? (sp.patient && UUID.test(sp.patient) ? sp.patient : null);
  const pet = petId ? await orNotFound(getPatient(shell.clinic, shell.location.id, petId)) : null;
  const visitDay = visit ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(visit.start_at) : null;

  return (
    <>
      <PageHeader
        title={visit ? `Move ${visit.patient_name}'s visit` : "Book a visit"}
        description={visit ? `${visit.service_name} with ${visit.provider_name ?? "the team"}` : "Times shown are free for the right doctor, room and equipment."}
      />
      <BookingFlow
        services={services.map((s) => ({ id: s.id, name: s.name, category: s.category, durationMin: s.duration_min, species: s.species }))}
        providers={data.providers.filter((p) => p.bookable && ["dvm", "technician", "assistant"].includes(p.role)).map((p) => ({ id: p.id, name: p.name }))}
        today={today}
        timezone={tz}
        initialPet={pet ? { id: pet.id, name: pet.name, species: pet.species, breed: pet.breed, owner: pet.owner_name } : null}
        reschedule={
          visit
            ? { id: visit.id, serviceId: visit.service_id, providerId: visit.provider_id, when: `${formatDayLong(visitDay!)} at ${formatTime(visit.start_at, tz)}` }
            : null
        }
      />
    </>
  );
}
