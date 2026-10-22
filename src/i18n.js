// -----------------------------------------------------------------------------
// The texts users read in Gladys (configuration button, connection status),
// in English and French.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });
const list = (items) => items.join(', ');

export const T = {
  noDevice: both(
    'No madVR Envy known yet: type their IP addresses in the configuration (the Envy must be on the first time).',
    "Aucun madVR Envy connu : saisissez leurs adresses IP dans la configuration (l'Envy doit être allumé la première fois).",
  ),
  check: (lines, interval, wait) => ({
    en: [
      ...lines.map((l) => l.en),
      wait > 0
        ? `Last read kept: the next one in ${wait} s (never more often than every ${interval} s)`
        : `Read now; refresh every ${interval} s`,
    ].join(' · '),
    fr: [
      ...lines.map((l) => l.fr),
      wait > 0
        ? `Dernière lecture conservée : la prochaine dans ${wait} s (jamais plus souvent que toutes les ${interval} s)`
        : `Lu à l'instant ; rafraîchissement toutes les ${interval} s`,
    ].join(' · '),
  }),
  checkLine: (label, reading) => {
    if (reading === undefined) {
      return both(`${label}: not read yet`, `${label} : pas encore lu`);
    }
    if (reading === null || reading.goingOff) {
      return both(
        `${label}: off or standby (not answering)`,
        `${label} : éteint ou en veille (ne répond pas)`,
      );
    }
    const en = ['on'];
    const fr = ['allumé'];
    if (reading.signal === true) {
      const res = reading.incoming?.resolution;
      en.push(res ? `input ${res}` : 'input signal');
      fr.push(res ? `entrée ${res}` : 'signal en entrée');
    } else if (reading.signal === false) {
      en.push('no input signal');
      fr.push('pas de signal en entrée');
    }
    return both(`${label}: ${en.join(', ')}`, `${label} : ${fr.join(', ')}`);
  },
  unreachable: (names) =>
    both(
      `Off or standby (not answering), asked again at every refresh: ${list(names)}.`,
      `Éteints ou en veille (ne répondent pas), redemandés à chaque rafraîchissement : ${list(names)}.`,
    ),
  noAnswerAt: (addresses) =>
    both(
      `No madVR Envy answers yet at: ${list(addresses)} (tried again every minute at most; the Envy must be on).`,
      `Aucun madVR Envy ne répond encore à : ${list(addresses)} (nouvel essai au plus chaque minute ; l'Envy doit être allumé).`,
    ),
  addressUnknown: (names) =>
    both(
      `Address unknown (another Envy answers at the old one): ${list(names)}. Type the new address in the configuration.`,
      `Adresse inconnue (un autre Envy répond à l'ancienne) : ${list(names)}. Saisissez la nouvelle adresse dans la configuration.`,
    ),
  invalidEntries: (entries) =>
    both(
      `Ignored in the configuration (invalid): ${list(entries)}.`,
      `Ignorés dans la configuration (invalides) : ${list(entries)}.`,
    ),
  invalidWakeAddress: both(
    'The Wake-on-LAN broadcast address is not an IPv4 address: the default one (255.255.255.255) is used.',
    "L'adresse de diffusion du Wake-on-LAN n'est pas une adresse IPv4 : celle par défaut (255.255.255.255) est utilisée.",
  ),
  wakeRefused: both(
    'Gladys refused to send Wake-on-LAN for this integration: allow it on the installation screen, or update Gladys.',
    "Gladys a refusé d'envoyer le Wake-on-LAN pour cette intégration : autorisez-le sur l'écran d'installation, ou mettez Gladys à jour.",
  ),
  dataReset: both(
    'The saved list of the Envy units was unreadable and was reset; they are found again from their addresses.',
    'La liste enregistrée des Envy était illisible et a été réinitialisée ; ils sont retrouvés par leurs adresses.',
  ),
};
