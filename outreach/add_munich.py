import openpyxl
wb = openpyxl.load_workbook('ginger_shoc_outreach_tracker.xlsx')

ws = wb.create_sheet('Munich')
headers = ['City', 'Category', 'Shop Name', 'Address', 'Phone', 'Rating', 'Website', 'Contact Email / Form', 'Outreach Status', 'Notes']
ws.append(headers)

rows = [
# Teeladen
('Munich','Teeladen','Tea For You','Nordendstr. 38, 80801 München','+49 89 2718454','4.5','https://teaforyou.bigcartel.com/','info@tea-for-you.com','Found','Exclusive teas and tea gifts, Schwabing.'),
('Munich','Teeladen','Friesische Teestube','Felix-Dahn-Str. 4, 81925 München','+49 89 986395','4.3','https://www.friesische-teestube.de/','info@friesische-teestube.de','Found','Tea room/café since 1975, moved from original Pündter Platz location.'),
('Munich','Teeladen','TEE- Spezialitäten & Präsente','Nordendstr., 80801 München (Maxvorstadt)','TBD','4.0','TBD — no dedicated website found','TBD','Not started','Independent specialty tea shop.'),
# Geschenkartikel
('Munich','Geschenkartikel','Herrmann Geschenke GmbH','Neuhauser Straße 2, 80331 München','+49 89 229308','4.0','https://www.herrmann-geschenke.de/','info@herrmann-geschenke.de','Found','Explicitly does wholesale AND retail (Großhandel & Einzelhandel) of gifts/souvenirs — good wholesale-ready contact.'),
('Munich','Geschenkartikel','servus.heimat','Tal 20 / Brunnstraße 3, 80331 München','+49 89 21019815','4.6','https://www.servusheimat.com/','shop@servusheimat.com','Found','Bavarian concept store reinterpreting classic souvenirs; parent company Schneider, van Ginkel, Neubauer GbR.'),
('Munich','Geschenkartikel','Münchner Geschenke-Stuben','Marienplatz 8, 80331 München','+49 89 221671','4.2','TBD — no dedicated website found','TBD — phone contact only (Inh. Sieglinde Konrad)','Not started','Independent, long-standing gift shop right on Marienplatz.'),
# Souvenirladen
('Munich','Souvenirladen','Made in Heimat (Viktualienmarkt)','Viktualienmarkt, Abt. 1, Stand 33, 80331 München','+49 89 85632870','4.4','https://www.mitbringsel-made-in-heimat.de/','Contact via mitbringsel-made-in-heimat.de — no public email found','Partial','Souvenir/gift stand at the Viktualienmarkt with online shop presence.'),
('Munich','Souvenirladen','Klösterl-Shop / Souvenirs Altstadt','Marienplatz UG, 80331 München','TBD','3.9','TBD — no dedicated website found','TBD','Not started','Underground-level souvenir shop at Marienplatz.'),
# Bioladen
('Munich','Bioladen','Hollerbusch Naturkost','Daiserstraße 5, 81371 München','+49 89 776474','4.5','https://www.hollerbusch-naturkost.de/','team@hollerbusch-naturkost.de','Found','Independent organic shop in Sendling, curated small-vendor selection.'),
('Munich','Bioladen','biochicco Biomarkt und Café','Ohlmüllerstraße 19, 81541 München','+49 89 20964718','4.3','https://www.biochicco.de/','Contact via biochicco.de — no public email found','Partial','Organic market + café; sourced from many small vendors rather than big-chain bio products.'),
# Reformhaus
('Munich','Reformhaus','VITALIA Reformhaus (Winthirstraße)','Winthirstraße 10, 80639 München','TBD','4.0','https://www.vitalia-reformhaus.de/','shop@vitalia-reformhaus.de (HQ — same VITALIA chain as Berlin/Hamburg entries)','Partial','Reuse VITALIA chain contact already used for Berlin.'),
('Munich','Reformhaus','VITALIA Reformhaus (Hohenzollernstraße)','Hohenzollernstraße 26, 80801 München','TBD','4.1','https://www.vitalia-reformhaus.de/','shop@vitalia-reformhaus.de (HQ)','Partial','Same VITALIA chain — reuse contact.'),
('Munich','Reformhaus','Reformhaus (Jörgstraße)','Jörgstraße 1, 80689 München-Laim','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Appears to be independent, not VITALIA-branded — verify by phone.'),
('Munich','Reformhaus','Reformhaus (Thalkirchner Straße, Sendling)','Thalkirchner Str. 137, 81371 München','+49 89 78508128','TBD','TBD — no dedicated website found','TBD','Not started','Independent Reformhaus in Sendling.'),
# Apotheke
('Munich','Apotheke','Marien-Apotheke','Sendlinger-Tor-Platz 7, 80336 München','+49 89 557565','4.2','https://www.marien-apotheke-muenchen.de/','info@marien-apotheke-muenchen.de','Found','Note: Heilmittelwerbegesetz (HWG) restricts pharmacy advertising in Germany, in addition to UWG/GDPR.'),
('Munich','Apotheke','Medicus-Apotheke','Sendlinger Straße 41, 80331 München','+49 89 24414640','4.4','https://www.medicus-apotheke.com/','service@medicus-apotheke.com','Found',None),
('Munich','Apotheke','Klösterl-Apotheke','Färbergraben 12/Hotterstr. 3, 80331 München','+49 89 54343211','4.5','https://www.kloesterl-apotheke.de/','apotheke@kloesterl.de','Found','Also runs online shop (kloesterl-shop.de) with its own contact form.'),
]

for r in rows:
    ws.append(r)

wb.save('ginger_shoc_outreach_tracker.xlsx')
print('Munich rows written:', len(rows))
