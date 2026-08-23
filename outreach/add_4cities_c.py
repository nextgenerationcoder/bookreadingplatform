import openpyxl
wb = openpyxl.load_workbook('ginger_shoc_outreach_tracker.xlsx')
headers = ['City', 'Category', 'Shop Name', 'Address', 'Phone', 'Rating', 'Website', 'Contact Email / Form', 'Outreach Status', 'Notes']

data = {
'Augsburg': [
    ('Augsburg','Reformhaus','Reformhaus Wohlgemuth (Friedberger Str.)','Friedberger Str. 135, 86163 Augsburg','+49 821 61180','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent, small local multi-location business (also Neue Str. 27 branch).'),
    ('Augsburg','Reformhaus','Parfümerie & Refo-Haus Sammüller (Inh. Alexandra Schneid)','Neuburger Str. 33, 86167 Augsburg-Lechhausen','+49 821 712321','TBD','https://www.parfuemerie-sammueller.de/','Contact via parfuemerie-sammueller.de — no public email found','Partial','Independent, combined perfumery + Reformhaus (neuform cooperative member).'),
],
'Wiesbaden': [
    ('Wiesbaden','Reformhaus','Reformhaus Diefenbach','Rathausstr. 44, 65203 Wiesbaden-Biebrich','+49 611 600644','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent.'),
    ('Wiesbaden','Reformhaus','Reformhaus FREYA KG','Neugasse 3, 65183 Wiesbaden','+49 611 377687','TBD','TBD — no dedicated website found','Contact via schrotundkorn.de listing — email obscured in search results, needs direct follow-up','Partial','Independent.'),
    ('Wiesbaden','Reformhaus','Liwell Reformhaus Herrmann','Moritzstraße / Neugasse / Bierstadt, Wiesbaden','TBD','TBD','https://reformhaus.de/blogs/reformhaus-herrmann/','Contact via reformhaus.de/blogs/reformhaus-herrmann/ — no direct email confirmed','Excluded (chain)','Family business but operates multiple Wiesbaden branches under one "Liwell" brand since 1984 — centralized purchasing likely.'),
],
'Mönchengladbach': [
    ('Mönchengladbach','Reformhaus','Reformhaus Haas (Bettina Haas)','Hindenburgstraße 157, 41061 Mönchengladbach','+49 2161 23681','TBD','http://www.reformhaus-haas.de/','b.haas@reformhaus-haas.de','Found','Independent.'),
    ('Mönchengladbach','Reformhaus','Reformhaus GOLL (HQ, Mittelstraße)','Mittelstraße 12, Mönchengladbach','TBD','TBD','https://reformhaus.de/blogs/reformhaus-goll/','info@reformhaus-goll.de (same GOLL chain contact reused from Düsseldorf)','Excluded (chain)','This is the GOLL chain HQ itself (already excluded via Düsseldorf branches) — its home city.'),
],
'Gelsenkirchen': [
    ('Gelsenkirchen','Reformhaus','Reformhaus Sommerfeld','Arminstraße 24, 45879 Gelsenkirchen-Altstadt','+49 209 202370','TBD','http://www.reformhaus-sommerfeld.de/','Contact via reformhaus-sommerfeld.de — no public email found','Partial','Independent, "Treffpunkt für gesundes Leben".'),
],
}

for sheetname, rows in data.items():
    ws = wb.create_sheet(sheetname)
    ws.append(headers)
    for r in rows:
        ws.append(r)

wb.save('ginger_shoc_outreach_tracker.xlsx')
print('done', list(data.keys()))
