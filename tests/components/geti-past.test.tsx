import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: jest.fn(), showSuccess: jest.fn(), showInfo: jest.fn() }),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/components/i18n/locale-navigation", () => ({
  useLocaleRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { GetiFilters } from "@/components/geti/GetiFilters";
import { GetiPostCard } from "@/components/geti/GetiPostCard";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import type { GetiCategory, GetiParsedPost } from "@/lib/shared/geti";
import type { GetiStoredPost } from "@/lib/shared/geti/ingest";
import { emptyGetiPageQuery, GETI_CATEGORY_FILTERS } from "@/lib/shared/geti/page";
import { getiDataText } from "@/lib/shared/geti/page-text";
import enMessages from "@/messages/en/geti.json";
import frMessages from "@/messages/fr/geti.json";
import { parsedGetiPost } from "../helpers/geti";
import { readSource } from "../helpers/read-source";

/** Carte d'une annonce passée, horaire converti, case « Afficher les scrims passés ». */

const FRIDAY_MORNING = Date.parse("2026-11-27T09:00:00.000Z");
const SATURDAY_MORNING = Date.parse("2026-11-28T09:00:00.000Z");

/** Annonce du vendredi 27 novembre 2026, 21 h – 23 h. */
function storedPost(category: GetiCategory, overrides: Partial<GetiParsedPost> = {}): GetiStoredPost {
  const parsed = parsedGetiPost({
    category,
    text: "Annonce de test vendredi soir",
    dates: ["2026-11-27"],
    availability: { days: ["FRI"], times: [{ from: 1260, to: 1380 }], timezone: null },
    postedAt: "2026-11-26T12:00:00.000Z",
    ...overrides,
  });
  return {
    messageId: "100000000000000900",
    channelId: "100000000000000800",
    category,
    source: "direct",
    authorTag: "fauxjoueur",
    authorId: "100000000000000001",
    parsed,
    postedAt: "2026-11-26T12:00:00.000Z",
    editedAt: null,
  };
}

function renderCard(post: GetiStoredPost, now: number, locale: "fr" | "en" = "fr"): string {
  const messages = locale === "fr" ? frMessages : enMessages;
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <GetiPostCard post={post} filter={{}} text={messages.post} data={getiDataText(messages)} locale={locale} now={now} />
    </AppLocaleProvider>,
  );
}

function renderFilters(category: GetiCategory, locale: "fr" | "en", showPast = false): string {
  const messages = locale === "fr" ? frMessages : enMessages;
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <GetiFilters
        category={category}
        query={{ ...emptyGetiPageQuery(), showPast }}
        fields={GETI_CATEGORY_FILTERS[category]}
        ageOptions={[1, 3]}
        retentionDays={7}
        total={3}
        text={messages.filters}
        data={getiDataText(messages)}
      />
    </AppLocaleProvider>,
  );
}

describe("GetiPostCard — annonce passée", () => {
  it("GetiPostCard_pastScrim_showsThePastBadge", () => {
    const markup = renderCard(storedPost("lfs"), SATURDAY_MORNING);

    expect(markup).toContain('data-past="true"');
    expect(markup).toContain('data-testid="geti-past">Passé</span>');
  });

  it("GetiPostCard_pastScrimInEnglish_showsThePastBadge", () => {
    const markup = renderCard(storedPost("lfs"), SATURDAY_MORNING, "en");

    expect(markup).toContain('data-testid="geti-past">Past</span>');
  });

  it("GetiPostCard_pastSubSearch_showsThePastBadge", () => {
    const markup = renderCard(storedPost("lfsub"), SATURDAY_MORNING);

    expect(markup).toContain('data-testid="geti-past">Passé</span>');
  });

  it("GetiPostCard_recruitmentWithAPastDate_saysOnlyTheDateIsPast", () => {
    const markup = renderCard(storedPost("lfp"), SATURDAY_MORNING);

    expect(markup).toContain('data-testid="geti-past">Date passée</span>');
  });

  it("GetiPostCard_recruitmentWithAPastDateInEnglish_saysOnlyTheDateIsPast", () => {
    const markup = renderCard(storedPost("lfp"), SATURDAY_MORNING, "en");

    expect(markup).toContain('data-testid="geti-past">Date passed</span>');
  });

  it("GetiPostCard_upcomingScrim_hasNoBadge", () => {
    const markup = renderCard(storedPost("lfs"), FRIDAY_MORNING);

    expect(markup).not.toContain("geti-past");
    expect(markup).not.toContain("data-past");
  });

  it("GetiPostCard_undatedPost_hasNoBadge", () => {
    const post = storedPost("lfs", { dates: [], availability: { days: [], times: [], timezone: null } });

    expect(renderCard(post, SATURDAY_MORNING)).not.toContain("geti-past");
  });
});

describe("GetiPostCard — horaire converti", () => {
  const converted = storedPost("lfs", {
    availability: {
      days: ["FRI"],
      times: [{ from: 1260, to: 1380 }],
      timezone: "UTC",
      statedTimes: [{ from: 1200, to: 1320 }],
    },
  });

  it("GetiPostCard_convertedTime_showsParisTimeAndTheTimeAsWritten", () => {
    const markup = renderCard(converted, FRIDAY_MORNING);

    expect(markup).toContain("21h – 23h (heure de Paris)");
    expect(markup).toContain("Dans l&#x27;annonce : 20h – 22h (UTC)");
  });

  it("GetiPostCard_convertedTimeInEnglish_showsParisTimeAndTheTimeAsWritten", () => {
    const markup = renderCard(converted, FRIDAY_MORNING, "en");

    expect(markup).toContain("21:00 – 23:00 (Paris time)");
    expect(markup).toContain("In the post: 20:00 – 22:00 (UTC)");
  });

  it("GetiPostCard_timeWithoutZone_hasNoTitle", () => {
    const markup = renderCard(storedPost("lfs"), FRIDAY_MORNING);

    expect(markup).toContain('<li class="cy-tag cy-tag-success">21h – 23h</li>');
  });
});

describe("GetiPostCard — passé et clos", () => {
  it("GetiPostCard_closedAndPast_showsOnlyTheClosedPill", () => {
    const post = storedPost("lfs", { closed: true });
    const markup = renderCard(post, SATURDAY_MORNING);

    expect(markup).toContain("Close");
    expect(markup).not.toContain("geti-past");
    expect(markup).toContain("cardClosed");
    expect(markup).not.toContain("cardPast");
  });

  it("GetiPostCard_pastScrim_hasItsOwnFadedClass", () => {
    const markup = renderCard(storedPost("lfs"), SATURDAY_MORNING);

    expect(markup).toContain("cardPast");
    expect(markup).not.toContain("cardClosed");
  });
});

describe("GetiInfoView — liste vide, scrims passés masqués", () => {
  it("GetiInfoView_emptyWhilePastHidden_saysPastScrimsAreHidden", () => {
    const source = readSource("components/geti/GetiInfoView.tsx");

    expect(source).toContain("getiHidesPast(category) && !query.showPast");
    expect(source).toContain("text.emptyPast");
    expect(frMessages.results.emptyPast).toContain("passés sont masqués");
    expect(enMessages.results.emptyPast).toContain("Past scrims are hidden");
  });
});

describe("GetiFilters — scrims passés", () => {
  it("GetiFilters_scrims_offerTheShowPastCheckbox", () => {
    const markup = renderFilters("lfs", "fr");

    expect(markup).toContain("Afficher les scrims passés");
    expect(markup).toContain("Un scrim est passé quand sa dernière date et son créneau sont finis");
  });

  it("GetiFilters_scrimsInEnglish_offerTheShowPastCheckbox", () => {
    expect(renderFilters("lfs", "en")).toContain("Show past scrims");
  });

  it("GetiFilters_recruitment_doesNotOfferIt", () => {
    expect(renderFilters("lfp", "fr")).not.toContain("Afficher les scrims passés");
  });

  it("GetiFilters_showPastInTheAddress_checksTheBox", () => {
    const checked = renderFilters("lfs", "fr", true).split("Afficher les scrims passés")[0];

    expect(checked.slice(checked.lastIndexOf("<input"))).toContain('checked=""');
  });

  it("GetiFilters_dayAndTimeHints_sayParisTimeAndUpcomingEvenings", () => {
    const markup = renderFilters("lfs", "fr");

    expect(markup).toContain("Un jour désigne une soirée à venir");
    expect(markup).toContain("sans fuseau l&#x27;annonce est lue à l&#x27;heure de Paris");
  });
});

describe("GetiInfoView — lien sous le compteur", () => {
  it("GetiInfoView_scrims_linkTogglesThePastParam", () => {
    const source = readSource("components/geti/GetiInfoView.tsx");

    expect(source).toContain("getiHidesPast(category) ?");
    expect(source).toContain("showPast: !query.showPast, page: 1");
    expect(source).toContain("query.showPast ? m.results.hidePast : m.results.showPast");
  });

  it("messages_pastTexts_existInBothLanguages", () => {
    expect(frMessages.results.showPast).toBe("Afficher les scrims passés");
    expect(frMessages.results.hidePast).toBe("Masquer les scrims passés");
    expect(enMessages.results.showPast).toBe("Show past scrims");
    expect(enMessages.results.hidePast).toBe("Hide past scrims");
  });
});
