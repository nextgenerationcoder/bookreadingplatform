import openpyxl
wb = openpyxl.load_workbook('ginger_shoc_outreach_tracker.xlsx')

ws = wb.create_sheet('Hamburg')
headers = ['City', 'Category', 'Shop Name', 'Address', 'Phone', 'Rating', 'Website', 'Contact Email / Form', 'Outreach Status', 'Notes']
ws.append(headers)

rows = [
# Teeladen
('Hamburg','Teeladen','Teekontor im Wasserschloss','Dienerreihe 4, 20457 Hamburg','+49 40 32050700 (Wasserschloss)','4.6','https://wasserschloss.de/teekontor.html','Contact via wasserschloss.de contact page — no direct email confirmed','Partial','Located inside the historic Wasserschloss building in Speicherstadt; high-traffic tourist location.'),
('Hamburg','Teeladen','Eimsbüttler Tee Kontor','Osterstraße 170, 20255 Hamburg','TBD','4.7','https://www.eimsbuettler-teekontor.de/','Contact form on eimsbuettler-teekontor.de — no public email found','Partial','Independent, 250+ teas, since 1999.'),
('Hamburg','Teeladen','Tee-Handels-Kontor Bremen (Filiale Eppendorf)','Eppendorfer Baum 43, 20249 Hamburg','+49 40 353784','4.5','https://www.tee-handelskontor-bremen.de/filialen/hamburg-eppendorf','hamburg@thk-bremen.de','Found','Chain (Bremen-based) — reuse contact for other THK Bremen branches in other cities.'),
('Hamburg','Teeladen','Hamburger Teehaus','Hoheluftchaussee 29, 20253 Hamburg','+49 40 42913618','4.7','https://hamburger-teehaus.de/','mail@hamburger-teehaus.de','Found','Independent, owner Mahashweta Leonhardt, 280+ teas.'),
('Hamburg','Teeladen','TEE-MAASS (Theodor Maass GmbH)','Börsenbrücke 2a, 20457 Hamburg','+49 40 3742474','4.5','https://www.tee-maass.de/','Contact form: tee-maass.de — also a wholesale tea exporter (est. 1887), likely open to trade contact','Partial','Also does B2B tea export to 20+ countries — worth pitching their trade desk if a direct wholesale email is found on a follow-up visit.'),
# Geschenkartikel
('Hamburg','Geschenkartikel','baqu','Susannenstraße 39-41, 20357 Hamburg','+49 40 433814','4.5','https://baqu-hamburg.jimdo.com/','info@baqushop.de','Found','Independent gift/lifestyle concept store in Schanzenviertel, 35+ years, 3500+ curated items.'),
('Hamburg','Geschenkartikel','All My Friends – Concept Store','Schanzenstraße 34, 20357 Hamburg','+49 176 74503378','4.6','https://allmyfriends.info/','Contact via allmyfriends.info (no public email found; phone/Instagram DM likely primary channel)','Partial','NOTE: concept store hosting 250+ small/handmade/fairtrade labels — may work like a shelf-rental/consignment model similar to Berlin\'s Promobo/Vielfach; verify buying model before pitching.'),
('Hamburg','Geschenkartikel','Der Erzgebirgsladen im Levantehaus','Mönckebergstraße 7, 20095 Hamburg','+49 40 30384028','4.5','https://www.erzgebirge.hamburg/','kontakt@erzgebirge.hamburg','Found','Specialist since 1981 for Erzgebirge collectibles; has online shop — niche but established retail buyer.'),
# Souvenirladen
('Hamburg','Souvenirladen','Souvenirs am Michel','Krayenkamp 13, 20459 Hamburg','+49 40 371672','4.6','https://www.souvenirs-am-michel.de/','Contact via souvenirs-am-michel.de — no public email found','Partial','Upscale gift/souvenir shop near St. Michaelis church; described as more boutique than typical souvenir shop.'),
('Hamburg','Souvenirladen','St. Pauli Shop Kiosk','Reeperbahn 5, 20359 Hamburg','TBD','4.0','TBD','TBD — small kiosk, no dedicated website found','Not started','Kiosk-format souvenir shop on the Reeperbahn.'),
('Hamburg','Souvenirladen','Brücken Basar','Bei den St. Pauli Landungsbrücken 6, 20359 Hamburg','TBD','3.8','TBD','TBD — no dedicated website found; large open-air-style souvenir stall','Not started','High tourist footfall at Landungsbrücken harbor.'),
# Bioladen
('Hamburg','Bioladen','Denns BioMarkt (Ottensen)','Ottenser Hauptstraße 39, 22765 Hamburg','+49 40 28802871','4.2','https://www.denns-biomarkt.de/','info@denns.de (national wholesale/listing contact — same as used for Berlin Denns entry)','Found','National chain — reuse Denns HQ contact from Berlin sheet for all further Denns locations.'),
('Hamburg','Bioladen','warenwirtschaft cafe bioladen kollektiv oHG','Große Brunnenstraße 141, 22763 Hamburg','+49 40 63675734','3.0','TBD — no dedicated website found','TBD','Not started','Worker-collective bioladen with café in Ottensen (similar structure to Berlin\'s Kollektiv Bioase).'),
('Hamburg','Bioladen','Bio Produkte Eimsbüttel','Eppendorfer Weg 80, 20259 Hamburg','+49 40 4905768','4.0','TBD — no dedicated website found','TBD','Not started','Small independent organic/delicatessen shop.'),
# Reformhaus
('Hamburg','Reformhaus','Reformhaus Engelhardt (Vita Nova) – Große Bleichen','Große Bleichen 36, 20354 Hamburg','TBD','4.0','https://vita-nova.de/standorte/reformhaus-engelhardt/','Contact via vita-nova.de/standorte/reformhaus-engelhardt/ contact page — no single national email found; each Vita Nova brand line has its own contact form','Partial','Chain: VITA NOVA REFORMHÄUSER GMBH — 10+ Hamburg locations (Eppendorf, HafenCity, Wandsbek, Blankenese, Bergedorf, etc). Reuse vita-nova.de contact for all Engelhardt branches.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt Perle','Gerhart-Hauptmann-Platz 4, 20095 Hamburg','TBD','4.1','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact as above','Partial','Same chain as Große Bleichen location.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt Hamburger Meile','Hamburger Straße 47-49, 22083 Hamburg','TBD','4.0','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact as above','Partial','Same chain as above.'),
('Hamburg','Reformhaus','Sven Kniesch Reformhaus','Fuhlsbüttler Str. 102, 22305 Hamburg','+49 40 6913868','TBD','TBD — status uncertain, some sources suggest closed','TBD — verify by phone before contacting','Not started','CAUTION: some directories suggest this business may have dissolved — verify it is still operating before outreach.'),
# Apotheke
('Hamburg','Apotheke','Roths alte englische Apotheke','Jungfernstieg 48, 20354 Hamburg','+49 40 343906','4.5','https://alte-englische-apotheke.de/','Contact via alte-englische-apotheke.de — no public email found','Partial','Historic pharmacy (1928 interior) — high-profile central location. Note: Heilmittelwerbegesetz (HWG) restricts pharmacy advertising in Germany in addition to UWG/GDPR.'),
('Hamburg','Apotheke','Mö-City-Apotheke','Mönckebergstraße 3, 20095 Hamburg','+49 40 87978300','4.0','https://www.apotheken.de/20095/Hamburg/moe-city-apotheke/','TBD — no dedicated shop website found; use apotheken.de profile page for contact form','Not started',None),
('Hamburg','Apotheke','HafenCity Apotheke','Überseeboulevard 7, 20457 Hamburg','+49 40 83504401','4.3','https://hhafencityapotheke.de/','info@hhafencityapotheke.de','Found','Multilingual pharmacy (German, English, Dari, Farsi, Arabic, Vietnamese, Swedish) — relevant for import/exotic products angle.'),
]

for r in rows:
    ws.append(r)

wb.save('ginger_shoc_outreach_tracker.xlsx')
print('Hamburg rows written:', len(rows))
