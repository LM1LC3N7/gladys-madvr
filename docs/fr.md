# madVR Envy pour Gladys

Suivez et pilotez vos processeurs vidéo **madVR Envy** (Envy Core, Pro,
Extreme) depuis Gladys, en local, sans aucun cloud : état de marche, signal
d'entrée et de sortie (résolution, fréquence, HDR), format d'image détecté,
températures internes, allumage, veille, extinction, profils, tone mapping et
touches de télécommande.

> **Important.** Cette intégration n'a jamais été testée avec un vrai
> appareil : elle a été écrite d'après la bibliothèque `py-madvr2` (celle de
> Home Assistant) et testée avec un faux Envy seulement. Vos retours sont les
> bienvenus. Intégration non officielle, sans lien avec madVR Labs.

## Installation

1. Branchez l'Envy sur votre réseau et donnez-lui une **adresse IP fixe** dans
   votre box (bail DHCP réservé).
2. Allumez l'Envy : il n'écoute le réseau (port TCP 44077) qu'allumé.
3. Dans Gladys, installez l'intégration **madVR Envy** et acceptez
   l'autorisation **Wake-on-LAN** (Gladys envoie elle-même le paquet de réveil
   sur votre réseau).
4. Ouvrez sa configuration et saisissez les adresses IP, séparées par des
   virgules (par exemple `192.168.1.60` ; port 44077 par défaut, un autre sous
   la forme `192.168.1.60:44078`).
5. L'Envy apparaît dans l'onglet **Découverte** : créez-le.

La première fois, l'Envy doit être allumé : l'intégration lit son adresse
MAC, qui l'identifie ensuite (et sert au Wake-on-LAN) ; son adresse IP peut
changer : saisissez la nouvelle.

## Ce que vous obtenez

| Fonction                                          | Type Gladys                    | Remarque                                                    |
| ------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| Marche                                            | état binaire (lecture seule)   | 1 quand l'Envy répond, 0 sinon (éteint ou en veille)        |
| État de marche                                    | texte (lecture seule)          | en anglais : On, Off or standby                             |
| Allumer (Wake-on-LAN)                             | bouton                         | envoyé seulement quand l'Envy ne répond pas                 |
| Veille, Éteindre                                  | boutons                        | jamais bloqués, voir plus bas                               |
| Signal en entrée, Entrée HDR                      | états binaires (lecture seule) | HDR : HDR10, HLG…                                           |
| Résolution, fréquence, dynamique, couleur, format | textes (lecture seule)         | du signal d'entrée, par exemple 3840x2160, 23.976p, HDR10   |
| Résolution, fréquence, dynamique de sortie        | textes (lecture seule)         |                                                             |
| Format d'image détecté, masquage                  | textes (lecture seule)         | par exemple 2.40:1 (Panavision)                             |
| Températures GPU, HDMI, CPU, carte mère           | température de l'appareil, °C  | hors des moyennes de la pièce                               |
| Activer un profil                                 | liste                          | profils Source, Display ou Custom 1 à 9                     |
| Tone mapping activé / désactivé                   | boutons                        |                                                             |
| Touche                                            | liste                          | Menu, flèches, OK, Input, Settings, couleurs (jamais Power) |

Volontairement, aucun **interrupteur** : un « éteins tout » ou « allume
tout » d'un assistant vocal ou d'une scène n'allume ni n'éteint jamais votre
Envy. Utilisez les boutons dans vos scènes.

## Commandes

- **Veille** et **Éteindre** sont les commandes protectrices : elles partent
  tout de suite, sans attendre une lecture ni une autre commande, et en un seul
  essai. Elles annulent toute commande en cours ou en attente (Allumer et ses
  Wake-on-LAN répétés compris) : rien de ce qui attendait ne part après
  elles. Si l'Envy ne répond pas :
  - dans les 2 minutes qui suivent un Wake-on-LAN (il démarre peut-être) : la
    commande est refusée « does not answer yet: Standby will be sent once it
    answers, nothing sent yet » (rien n'est encore envoyé), et l'intégration
    l'envoie une fois, dès que l'Envy répond, dans la minute qui suit la
    demande (et dans les 2 minutes du Wake-on-LAN). Un nouvel appui sur Allumer
    dans Gladys l'annule ; un allumage par la télécommande ou le bouton en
    façade ne l'annule pas : fait dans cette minute, l'Envy peut être remis en
    veille dès qu'il répond ;
  - sinon : elle réussit (rien à envoyer) seulement si la dernière lecture,
    faite dans l'intervalle de rafraîchissement, avait déjà trouvé l'Envy
    muet ; sinon elle est refusée « does not answer, nothing sent ».
- **Allumer** relit d'abord l'Envy : s'il répond, rien n'est envoyé ; sinon
  Gladys envoie un paquet Wake-on-LAN à son adresse MAC, puis à nouveau toutes
  les 10 secondes pendant 2 minutes, jusqu'à ce qu'il réponde. Si la lecture
  qui vient de finir (5 secondes au plus) l'a trouvé muet, ou si son adresse
  est inconnue, le Wake-on-LAN part tout de suite (seule la MAC est
  nécessaire). Si Gladys répond « trop de demandes », le paquet est redemandé
  une fois 2 secondes plus tard ; si Gladys ne répond pas ou échoue, la
  commande est signalée « Wake-on-LAN peut-être envoyé, sans confirmation de
  Gladys » et les renvois continuent.
- **Profil**, **tone mapping** et **touche** ne partent que si l'Envy répond.

Avant chaque commande, l'intégration relit l'adresse MAC de l'Envy : si un
autre Envy répond à cette adresse IP, rien n'est envoyé et l'adresse est
oubliée. Une MAC donnée mais illisible (ou refusée par `ERROR`) ne compte pas
comme un autre appareil : la commande part. Une MAC sans réponse à temps
arrête un profil, un tone mapping ou une touche (« rien envoyé »), jamais la
Veille ni l'Arrêt (envoyés dans une nouvelle connexion). Une lecture dont la
MAC ne répond pas ne publie rien et garde les valeurs connues.

Chaque commande reçoit une réponse en moins de 4 secondes (Gladys attend 5
secondes). Une commande partie sans confirmation de l'Envy à temps est
signalée « envoyée, sans confirmation » ; une commande refusée par l'Envy
(`ERROR`) est signalée comme refusée ; une commande qui n'a pas pu partir est
signalée « rien envoyé ». L'Envy est relu 5 secondes après la dernière d'une
série de commandes, et pas du tout si rien n'est parti.

## Bouton de la configuration

- **Vérifier les Envy** : lit chaque Envy si l'intervalle de rafraîchissement
  est écoulé, sinon montre la dernière lecture et l'heure de la prochaine.

## Rafraîchissement, statut et limites

- Chaque Envy est lu toutes les 30 secondes par défaut (10 à 300), en une
  courte connexion fermée aussitôt. Jamais plus souvent : ni la reconnexion à
  Gladys, ni un enregistrement de configuration inchangée, ni le bouton, ni un
  redémarrage du conteneur (l'heure de la dernière tentative est gardée dans
  `/data`) ne déclenchent une lecture plus tôt.
- Un Envy qui ne répond pas affiche la marche à 0 et « Off or standby », et
  est cité dans le statut de l'intégration.
- Si un autre Envy répond à l'adresse d'un Envy créé (adresse changée), ce
  dernier affiche aussi la marche à 0 et « Off or standby » : c'est une
  supposition (il est peut-être allumé à sa nouvelle adresse), jusqu'à ce que
  vous saisissiez sa nouvelle adresse.
- Gladys accepte 300 états par minute par intégration : seules les valeurs qui
  changent sont envoyées, et au-delà, la dernière valeur de chaque fonction
  attend la minute suivante.

## Données et confidentialité

L'intégration garde dans `/data/madvr.json` les Envy connus (adresse MAC,
adresse IP, port) et l'heure de la dernière lecture. Le protocole n'a pas de
mot de passe : aucun secret n'est demandé ni gardé. Rien ne sort de votre
réseau local.

## Limites connues

- L'Envy ne répond qu'allumé : éteint ou en veille, l'intégration ne peut pas
  les distinguer (« Off or standby »).
- Le profil actif n'est pas encore lu ; les profils proposés sont les numéros
  1 à 9 de chaque groupe, sans leurs noms.
- Pas encore de redémarrage, de message à l'écran ni de menus.
- Jamais testé avec un vrai appareil : les réponses réelles peuvent différer.
