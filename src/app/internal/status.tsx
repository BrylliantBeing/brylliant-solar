import { ComingSoon, InternalPage } from '@/components/internal/internal-page';

export default function InternalStatus() {
  return (
    <InternalPage
      eyebrow="Status"
      title="Status checks"
      lede="Health of the services the business runs on. Each check will be a staff-only PHP endpoint that calls require_staff().">
      <ComingSoon title="Website and booking form">
        Whether /api/quote.php can reach the Hostinger SMTP server, and when the last lead was sent.
      </ComingSoon>
      <ComingSoon title="Inverter monitoring">
        The last upload from each customer inverter, with sites that have gone quiet flagged.
      </ComingSoon>
      <ComingSoon title="Calculator data">
        How old the sun profile and the outage history are, and when each was last rebuilt.
      </ComingSoon>
    </InternalPage>
  );
}
