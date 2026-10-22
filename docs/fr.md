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
  essai. Elles annulent un allumage en cours ou en attente (y compris les
  Wake-on-LAN répétés). Si l'Envy ne répond pas (déjà éteint ou en veille),
  rien n'est envoyé et la commande réussit.
- **Allumer** relit d'abord l'Envy : s'il répond, rien n'est envoyé ; sinon
  Gladys envoie un paquet Wake-on-LAN à son adresse MAC, puis à nouveau toutes
  les 10 secondes pendant 2 minutes, jusqu'à ce qu'il réponde.
- **Profil**, **tone mapping** et **touche** ne partent que si l'Envy répond.

Avant chaque commande, l'intégration relit l'adresse MAC de l'Envy : si un
autre Envy répond à cette adresse IP, rien n'est envoyé et l'adresse est
oubliée. Une MAC illisible ne compte pas comme un autre appareil.

Chaque commande reçoit une réponse en moins de 4 secondes (Gladys attend 5
secondes). Une commande partie sans confirmation de l'Envy à temps est
signalée « envoyée, sans confirmation » ; une commande refusée par l'Envy
(`ERROR`) est signalée comme refusée ; une commande qui n'a pas pu partir est
signalée « rien envoyé ». L'Envy est relu 5 secondes après chaque commande.

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
