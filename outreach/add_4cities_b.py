import openpyxl
wb = openpyxl.load_workbook('ginger_shoc_outreach_tracker.xlsx')
headers = ['City', 'Category', 'Shop Name', 'Address', 'Phone', 'Rating', 'Website', 'Contact Email / Form', 'Outreach Status', 'Notes']

data = {
'Bonn': [
    ('Bonn','Reformhaus','Reformhaus Ahner','Theaterplatz 10-12, 53177 Bonn-Bad Godesberg','+49 228 351010','TBD','http://www.bonn-reformhaus.de/','reformhaus-ahner@t-online.de','Found','Independent.'),
    ('Bonn','Reformhaus','Reformhaus Hörsch','Sternstr. 65, 53111 Bonn','+49 228 3694990','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent.'),
    ('Bonn','Reformhaus','Reformhaus Barbara Blattner e.K.','Rochusstr. 230-234, 53123 Bonn-Duisdorf','+49 228 623101','TBD','http://reformhaus-blattner.de/','blattner@reformhaus-blattner.de','Found','Independent.'),
    ('Bonn','Reformhaus','Vita Nova Reformhaus Pothmann (Bonn)','Bonn (exact address TBD)','TBD','TBD','https://reformhaus.de/blogs/vita-nova/reformhaus-pothmann-bonn','Contact via reformhaus.de/blogs/vita-nova/reformhaus-pothmann-bonn — no direct email confirmed','Excluded (chain)','Pothmann family business but operates multiple branches across cities (Duisburg origin + Düsseldorf + Bonn) under one company — centralized purchasing likely.'),
],
'Münster': [
    ('Münster','Reformhaus','[No independent Reformhaus identified yet]','','','','','','Not started','Both Münster locations found (Ludgeristr. 72, Klemensstr. 3) are Reformhaus Bacher GmbH & Co. KG branches — same chain already excluded in Düsseldorf/Essen/Hannover/Bochum/Bielefeld. No independent alternative surfaced in initial search; flagging as a gap for follow-up rather than fabricating an entry.'),
],
'Karlsruhe': [
    ('Karlsruhe','Reformhaus','Reformhaus Karl Böser (Inh. Cornelie Hornung e.K.)','Pfinztalstr. 11, 76227 Karlsruhe-Durlach','+49 721 41811','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent, sole proprietorship; also has a branch at Douglasstr. 24, 76133 Karlsruhe.'),
    ('Karlsruhe','Reformhaus','Vita Nova Reformhaus Neuleben','Pfinztalstr. 11, 76227 Karlsruhe','TBD','TBD','https://reformhaus.de/blogs/vita-nova/reformhaus-neuleben-kontakt','Contact via reformhaus.de/blogs/vita-nova/reformhaus-neuleben-kontakt','Excluded (chain)','Vita Nova brand-affiliated (OHG, owners Andrea & Marius-Ravel Scheib) — treating as chain per consistent Vita Nova exclusion policy.'),
],
'Mannheim': [
    ('Mannheim','Reformhaus','Reformhaus Stamm (Inh. Günter Stamm)','Meerwiesenstraße 25, 68163 Mannheim-Lindenhof','+49 621 812240','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent — one directory source claims it has closed, another shows it active; verify by phone before outreach.'),
    ('Mannheim','Reformhaus','Reformhaus Escher (Q6)','Q 6 14, 68161 Mannheim','TBD','TBD','https://reformhaus.de/blogs/vita-nova/reformhaus-escher-mannheim-q7','Contact via reformhaus.de/blogs/vita-nova/reformhaus-escher-mannheim-q7 — no direct email confirmed','Excluded (chain)','Same Vita Nova/Escher chain already excluded in Stuttgart.'),
],
}

for sheetname, rows in data.items():
    ws = wb.create_sheet(sheetname)
    ws.append(headers)
    for r in rows:
        ws.append(r)

wb.save('ginger_shoc_outreach_tracker.xlsx')
print('done', list(data.keys()))
